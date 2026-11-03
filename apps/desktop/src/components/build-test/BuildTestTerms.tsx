import { useId } from 'react'

const terms: Record<string, string> = {
  受管工作区: 'DevFlow 为这个任务单独准备的一份项目副本，你的项目目录不会被改。',
  基线: '改代码前先把现有测试跑一遍，确认原来是好的。',
  'Draft PR': 'GitHub 上的草稿合并请求，评审人能看，合并要人来点。',
  'CI 检查': 'GitHub 上自动跑的检查。',
  交付包: '要发到 GitHub 的 PR 描述和改动清单，已去掉密钥等敏感内容。',
}
function Term({ word }: { word: string }) {
  const id = useId()
  return <span className="build-test-term" tabIndex={0} aria-describedby={id}>{word}<span id={id} role="tooltip">{terms[word]}</span></span>
}
export function BuildTestText({ text, raw = [] }: { text: string; raw?: readonly string[] | undefined }) {
  const keys = [...new Set([...raw.filter(Boolean), ...Object.keys(terms)])].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(${keys.map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gu')
  return <>{text.split(pattern).map((part, i) => raw.includes(part) ? <code key={i} data-raw-material>{part}</code> : terms[part] ? <Term key={i} word={part} /> : part)}</>
}
