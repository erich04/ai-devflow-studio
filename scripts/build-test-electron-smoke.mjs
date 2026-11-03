// Reuse the isolated Main/API/model fixture; this variant drives the 03/04 renderer.
process.env.DEVFLOW_BUILD_TEST_SMOKE = '1'
await import('./native-coding-electron-smoke.mjs')
