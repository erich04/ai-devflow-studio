export function createView({ document, store, elements }) {
  const { form, input, message, list, emptyState } = elements;

  function setMessage(text) {
    if (message) message.textContent = text || '';
  }

  function render() {
    const tasks = store.listTasks();
    list.textContent = '';

    for (const task of tasks) {
      const item = document.createElement('li');
      item.className = 'task-item';
      item.dataset.id = task.id;
      if (task.done) item.classList.add('is-done');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'task-checkbox';
      checkbox.checked = task.done;
      checkbox.setAttribute('aria-label', `标记“${task.text}”为${task.done ? '未完成' : '已完成'}`);
      checkbox.addEventListener('change', () => {
        store.toggleTask(task.id);
        render();
      });

      const text = document.createElement('span');
      text.className = 'task-text';
      text.textContent = task.text;

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'delete-button';
      removeButton.textContent = '删除';
      removeButton.setAttribute('aria-label', `删除“${task.text}”`);
      removeButton.addEventListener('click', () => {
        store.removeTask(task.id);
        render();
      });

      item.append(checkbox, text, removeButton);
      list.append(item);
    }

    if (emptyState) emptyState.hidden = tasks.length > 0;
  }

  function submit() {
    const result = store.addTask(input.value);
    if (!result.ok) {
      if (result.reason === 'empty') {
        setMessage('请输入任务内容');
      } else if (result.reason === 'too-long') {
        setMessage('任务内容不能超过 200 个字符');
      } else {
        setMessage('添加任务失败，请重试');
      }
      return;
    }
    setMessage('');
    input.value = '';
    input.focus();
    render();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  render();

  return { render, submit };
}
