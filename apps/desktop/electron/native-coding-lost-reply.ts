import { vitestAssertion } from './native-coding-vitest-assertions'
import ts from 'typescript'
import { codingDigest } from './coding-candidate-workspace'

export const lostReplyHelper = '__devflowLoseReplyAfterCommit'

export function requestsLostAcknowledgement(text: string) {
  return (
    /提交|持久化|已保存|已写入|\b(?:commit(?:ted)?|persisted|saved)\b/iu.test(text) &&
    /(?:响应|回执|回包|回复).{0,10}(?:丢失|遗失|未送达)|(?:lost|dropped|missing)\s+(?:the\s+)?(?:response|reply|acknowledg(?:e)?ment)|(?:response|reply|acknowledg(?:e)?ment)\s+(?:is\s+|was\s+|gets\s+)?(?:lost|dropped)/iu.test(
      text,
    )
  )
}

/** A real client/adapter fixture has a controllable successful command and
 * observes its invocation. A stored row by itself never receives a reply. */
export function hasPublicReplySeam(body: string) {
  return (
    /\.mock(?:ResolvedValue|Implementation)(?:Once)?\s*\(/u.test(body) &&
    /\.toHaveBeen(?:Called|LastCalled|NthCalled)/u.test(body) &&
    /\b(?:await|render|fireEvent)\b/u.test(body)
  )
}

export function hasCommitThenLostReply(file: string, body: string) {
  if (!body.includes(lostReplyHelper)) return false
  const tree = ts.createSourceFile(
    file,
    body,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  let sites = 0,
    valid = true
  function examine(node: ts.Node) {
    if (ts.isIdentifier(node) && node.text === lostReplyHelper) {
      const call = node.parent
      if (!ts.isCallExpression(call) || call.expression !== node || call.arguments.length !== 1) {
        valid = false
        return
      }
      const callback = call.arguments[0]!
      if (!(ts.isFunctionExpression(callback) || ts.isArrowFunction(callback)) || callback.parameters.length) {
        valid = false
        return
      }
      // The host controls delivery through the injected command. Calling the
      // helper from the test body would never deliver a fault to the consumer.
      if (!ts.findAncestor(call.parent, (parent) => ts.isFunctionLike(parent))) {
        valid = false
        return
      }
      const effectBody = callback.body
      sites++
      const locals = new Set<string>()
      function local(n: ts.Node) {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) locals.add(n.name.text)
        ts.forEachChild(n, local)
      }
      local(effectBody)
      let effect = false
      function inspect(n: ts.Node) {
        if (ts.isFunctionLike(n)) return
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          let source = n.left
          while (ts.isPropertyAccessExpression(source) || ts.isElementAccessExpression(source)) source = source.expression
          if (ts.isIdentifier(source) && !locals.has(source.text)) effect = true
        }
        if (ts.isCallExpression(n)) {
          const target = n.expression,
            name = ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) ? target.name.text : ''
          if (/^mock(?:Resolved|Return)Value(?:Once)?$/u.test(name)) effect = true
          if (
            /^(?:save|write|commit|put|set|insert|upsert|persist|apply|dismiss|update|remove|delete|create|append)(?:[A-Z].*|$)/u.test(
              name,
            ) &&
            (n === effectBody || ts.isAwaitExpression(n.parent) || ts.isReturnStatement(n.parent))
          )
            effect = true
        }
        ts.forEachChild(n, inspect)
      }
      inspect(effectBody)
      if (!effect) valid = false
    }
    ts.forEachChild(node, examine)
  }
  examine(tree)
  return valid && sites === 1
}

export function replyDeliveryBody(body: string, lost: boolean) {
  const reached = '__devflowCommitted' + codingDigest(body).slice(0, 16)
  return `let ${reached}=false;
async function ${lostReplyHelper}(effect) {
  const value=await effect();
  ${reached}=true;
  ${lost ? "throw new Error('Acknowledgement lost after the committed effect');" : 'return value;'}
}
try { await (async()=>{\n${body}\n})(); }
catch(error){ if(!${reached} && (${vitestAssertion})(error)) throw new Error('DevFlowCommittedEffectNotReached'); throw error; }
if(!${reached}) throw new Error('DevFlowCommittedEffectNotReached');`
}
