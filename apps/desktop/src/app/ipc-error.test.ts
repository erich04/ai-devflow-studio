import { describe, expect, it } from 'vitest'
import { ipcErrorMessage } from './ipc-error'

describe('ipcErrorMessage', () => {
  it("removes Electron's channel prefix and keeps the message", () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'devflow:coding:runtime-budget-policy:get': Error: Team API unreachable"), '无法读取'))
      .toBe('Team API unreachable')
    expect(ipcErrorMessage(new Error("Error invoking remote method 'devflow:run:create': 名称不能为空"), '保存失败')).toBe('名称不能为空')
    expect(ipcErrorMessage(new Error('本地失败'), '保存失败')).toBe('本地失败')
  })
  it('uses the fallback when nothing readable is left', () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'devflow:x': Error: "), '保存失败')).toBe('保存失败')
    expect(ipcErrorMessage('not an error', '保存失败')).toBe('保存失败')
  })
})
