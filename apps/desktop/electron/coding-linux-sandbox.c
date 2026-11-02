/* Strict Linux fallback when user namespaces/bubblewrap are unavailable.
 * Landlock ABI >= 3 confines file contents and link/rename/truncation effects.
 * Seccomp closes operations Landlock cannot mediate, including metadata writes,
 * host-process access, named Unix sockets and io_uring. Unsupported means stop.
 * References: docs.kernel.org/userspace-api/{landlock,seccomp_filter}.html
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#if defined(__x86_64__)
#define NATIVE_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define NATIVE_ARCH AUDIT_ARCH_AARCH64
#else
#error Unsupported sandbox architecture
#endif
#define READ_RIGHTS (LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_EXECUTE)
#define ALL_RIGHTS ((1ULL << 15) - 1)
static void fail(const char *message) { fprintf(stderr, "DevFlow sandbox unavailable: %s: %s\n", message, strerror(errno)); exit(125); }
static void deny_call(struct sock_filter *filter, size_t *length, int number) {
  filter[(*length)++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)number, 0, 1);
  filter[(*length)++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
}
static void allow_values(struct sock_filter *filter, size_t *length, int number, unsigned int argument, const uint32_t *values, size_t count) {
  filter[(*length)++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)number, 0, (unsigned char)(count + 3));
  filter[(*length)++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (uint32_t)(offsetof(struct seccomp_data, args) + argument * sizeof(uint64_t)));
  for (size_t i = 0; i < count; i++) filter[(*length)++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, values[i], (unsigned char)(count - i), 0);
  filter[(*length)++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM);
  filter[(*length)++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  filter[(*length)++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
}
static void confine_syscalls(int network) {
  struct sock_filter filter[256] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, NATIVE_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, 0x40000000, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    // Newer kernels may add metadata mutation syscalls absent from build-time
    // headers (e.g. fchmodat2=452, setxattrat=463). Unknown calls fail closed.
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 451, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
  };
  size_t count = 8;
  // libuv needs nonblocking stdio. Allow descriptor-local control and read-only
  // terminal queries, never filesystem/device mutation ioctls.
  const uint32_t stdio_ioctls[] = { FIONBIO, FIONREAD, FIOCLEX, TCGETS, TIOCGWINSZ };
  allow_values(filter, &count, __NR_ioctl, 1, stdio_ioctls, sizeof stdio_ioctls / sizeof stdio_ioctls[0]);
  // libuv implements child stdio using anonymous connected stream pairs.
  // Unlike datagrams, these cannot reconnect or send to a different address.
  // Creating a named/abstract AF_UNIX socket remains forbidden in both modes.
  struct sock_filter stream_pairs[] = {
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socketpair, 0, 7),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_UNIX, 0, 3),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
    BPF_STMT(BPF_ALU | BPF_AND | BPF_K, (uint32_t)~(SOCK_CLOEXEC | SOCK_NONBLOCK)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SOCK_STREAM, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
  };
  memcpy(filter + count, stream_pairs, sizeof stream_pairs); count += sizeof stream_pairs / sizeof stream_pairs[0];
  if (network) {
    struct sock_filter inet_only[] = {
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 0, 5),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_INET, 2, 0),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_INET6, 1, 0),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    };
    memcpy(filter + count, inet_only, sizeof inet_only); count += sizeof inet_only / sizeof inet_only[0];
  } else { deny_call(filter, &count, __NR_socket); deny_call(filter, &count, __NR_connect); }
  const int denied[] = {
    __NR_ptrace, __NR_process_vm_readv, __NR_process_vm_writev,
    __NR_kill, __NR_tkill, __NR_tgkill, __NR_mount, __NR_umount2, __NR_pivot_root,
    __NR_unshare, __NR_setns, __NR_bpf, __NR_perf_event_open, __NR_keyctl,
    __NR_open_by_handle_at, __NR_fchmod, __NR_fchmodat, __NR_fchown, __NR_fchownat, __NR_utimensat,
    __NR_setxattr, __NR_lsetxattr, __NR_fsetxattr, __NR_removexattr, __NR_lremovexattr, __NR_fremovexattr,
    __NR_rt_sigqueueinfo, __NR_rt_tgsigqueueinfo,
#ifdef __NR_chmod
    __NR_chmod,
#endif
#ifdef __NR_chown
    __NR_chown, __NR_lchown,
#endif
#ifdef __NR_utime
    __NR_utime, __NR_utimes, __NR_futimesat,
#endif
#ifdef __NR_io_uring_setup
    __NR_io_uring_setup, __NR_io_uring_enter, __NR_io_uring_register,
#endif
#ifdef __NR_fsopen
    __NR_fsopen, __NR_fsconfig, __NR_fsmount, __NR_move_mount, __NR_open_tree,
#endif
#ifdef __NR_mount_setattr
    __NR_mount_setattr,
#endif
#ifdef __NR_fchmodat2
    __NR_fchmodat2,
#endif
#ifdef __NR_pidfd_getfd
    __NR_pidfd_getfd,
#endif
#ifdef __NR_pidfd_send_signal
    __NR_pidfd_send_signal,
#endif
  };
  for (size_t i = 0; i < sizeof denied / sizeof denied[0]; i++) deny_call(filter, &count, denied[i]);
  filter[count++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  struct sock_fprog program = { .len = (unsigned short)count, .filter = filter };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) fail("seccomp policy rejected");
}
static void grant(int ruleset, const char *path, int writable) {
  if (path[0] != '/' || strcmp(path, "/") == 0) { errno = EINVAL; fail("invalid grant root"); }
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) fail("cannot open grant root");
  struct stat info;
  if (fstat(fd, &info) != 0) fail("cannot inspect grant root");
  uint64_t rights = writable ? ALL_RIGHTS : READ_RIGHTS;
  if (!S_ISDIR(info.st_mode)) rights &= LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE;
  struct landlock_path_beneath_attr rule = { .allowed_access = rights, .parent_fd = fd };
  if (syscall(__NR_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0) != 0) fail("Landlock grant rejected");
  close(fd);
}
int main(int argc, char **argv) {
  int abi = (int)syscall(__NR_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 3) { errno = ENOTSUP; fail("Landlock ABI 3 or newer required"); }
  struct landlock_ruleset_attr attr = { .handled_access_fs = ALL_RIGHTS };
  int ruleset = (int)syscall(__NR_landlock_create_ruleset, &attr, sizeof attr, 0);
  if (ruleset < 0) fail("cannot create Landlock ruleset");
  int command = 0, network = 0, roots = 0;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--") == 0) { command = i + 1; break; }
    if (strcmp(argv[i], "--network=none") == 0) continue;
    if (strcmp(argv[i], "--network=enabled") == 0) { network = 1; continue; }
    if ((strcmp(argv[i], "--ro") == 0 || strcmp(argv[i], "--rw") == 0) && i + 1 < argc) {
      int writable = strcmp(argv[i], "--rw") == 0; grant(ruleset, argv[++i], writable); roots++; continue;
    }
    errno = EINVAL; fail("invalid launcher arguments");
  }
  if (!roots || command == 0 || command >= argc) { errno = EINVAL; fail("missing confined command"); }
  grant(ruleset, "/dev/null", 1); grant(ruleset, "/dev/urandom", 0); grant(ruleset, "/dev/random", 0);
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) fail("no_new_privs rejected");
  struct __user_cap_header_struct header = { .version = _LINUX_CAPABILITY_VERSION_3, .pid = 0 };
  struct __user_cap_data_struct capabilities[2] = {{0}, {0}};
  if (syscall(__NR_capset, &header, capabilities) != 0) fail("cannot drop capabilities");
  if (syscall(__NR_landlock_restrict_self, ruleset, 0) != 0) fail("Landlock enforcement rejected");
  close(ruleset); confine_syscalls(network);
  execvp(argv[command], argv + command); fail("confined exec failed");
}
