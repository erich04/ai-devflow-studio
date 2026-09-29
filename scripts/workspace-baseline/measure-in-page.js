// Runs inside the renderer through page.evaluate. Read-only: it never clicks, types or scrolls.
// Kept as plain browser JavaScript and passed as source text, so the TypeScript loader cannot
// inject helpers that do not exist in the page.
;(options) => {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const controlSelector = [
    'button',
    'a[href]',
    '[role="tab"]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
  ].join(', ')

  const round = (value) => Math.round(value * 100) / 100
  const toBox = (rect) => ({
    top: round(rect.top),
    bottom: round(rect.bottom),
    left: round(rect.left),
    right: round(rect.right),
    width: round(rect.width),
    height: round(rect.height),
  })

  function intersect(a, b) {
    const left = Math.max(a.left, b.left)
    const top = Math.max(a.top, b.top)
    const right = Math.min(a.right, b.right)
    const bottom = Math.min(a.bottom, b.bottom)
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  }

  // Clip a rect by the viewport and by every ancestor that clips overflow.
  function visiblePart(rect, element) {
    let clipped = intersect(rect, { left: 0, top: 0, right: viewport.width, bottom: viewport.height })
    for (let ancestor = element; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        clipped = intersect(clipped, ancestor.getBoundingClientRect())
      }
      if (clipped.width <= 0 || clipped.height <= 0) return null
    }
    return clipped.width > 0 && clipped.height > 0 ? clipped : null
  }

  function isRendered(element) {
    if (!element.isConnected) return false
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
    }
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    }
    return true
  }

  function isElementVisible(element) {
    if (!isRendered(element)) return false
    return visiblePart(element.getBoundingClientRect(), element) !== null
  }

  function accessibleName(element) {
    const labelledBy = element.getAttribute('aria-labelledby')
    const byId = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
      : ''
    const raw =
      element.getAttribute('aria-label') ||
      byId ||
      element.innerText ||
      element.getAttribute('placeholder') ||
      element.getAttribute('title') ||
      (element instanceof HTMLInputElement ? element.value : '') ||
      ''
    return raw.replace(/\s+/g, ' ').trim().slice(0, 80)
  }

  function describeControl(element) {
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') ?? undefined,
      name: accessibleName(element),
      disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
      box: toBox(element.getBoundingClientRect()),
    }
  }

  const controls = [...document.querySelectorAll(controlSelector)].filter(isElementVisible)

  const controlScopes = {}
  for (const [name, selector] of Object.entries(options.controlScopes ?? {})) {
    const scopes = [...document.querySelectorAll(selector)]
    controlScopes[name] = controls.filter((control) => scopes.some((scope) => scope.contains(control))).length
  }

  // Visible text nodes: judged by the rects of the text itself, clipped by overflow ancestors.
  function visibleTextNodes(root) {
    const result = []
    if (!root) return result
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      if (!text.trim()) continue
      const parent = node.parentElement
      if (!parent || !isRendered(parent)) continue
      if (parent.closest('script, style, noscript, template')) continue
      range.selectNodeContents(node)
      const visible = [...range.getClientRects()].some((rect) => visiblePart(rect, parent) !== null)
      if (visible) result.push({ node, parent, text })
    }
    return result
  }

  const fontRoot = document.querySelector(options.fontRoot ?? 'main')
  const fontCounts = {}
  for (const { parent } of visibleTextNodes(fontRoot)) {
    const size = round(parseFloat(getComputedStyle(parent).fontSize))
    fontCounts[size] = (fontCounts[size] ?? 0) + 1
  }
  const fontSizes = Object.keys(fontCounts).map(Number).sort((a, b) => a - b)

  const regions = {}
  for (const [name, spec] of Object.entries(options.regions ?? {})) {
    const selector = typeof spec === 'string' ? spec : spec.selector
    const pick = typeof spec === 'string' ? 'first' : spec.pick ?? 'first'
    const matches = [...document.querySelectorAll(selector)].filter(isRendered)
    let target = matches.find((element) => element.getBoundingClientRect().height > 0)
    if (target && pick === 'first-visible-child') {
      target = [...target.children].find((child) => isElementVisible(child)) ?? null
    }
    regions[name] = target ? { found: true, matches: matches.length, box: toBox(target.getBoundingClientRect()) } : { found: false, matches: matches.length }
  }

  const bodyText = visibleTextNodes(document.body).map(({ text }) => text)
  const phrases = {}
  for (const phrase of options.phrases ?? []) {
    let count = 0
    for (const text of bodyText) {
      for (let index = text.indexOf(phrase); index !== -1; index = text.indexOf(phrase, index + phrase.length)) count += 1
    }
    phrases[phrase] = count
  }

  const truncation = []
  for (const element of document.querySelectorAll(options.truncationSelector ?? '[data-measure-truncation]')) {
    if (!isRendered(element)) continue
    const candidates = [element, ...element.querySelectorAll('*')]
    // Text overflowing inside the element itself (ellipsis, hidden overflow).
    const overflowsItself = candidates.some((candidate) => candidate.scrollWidth > candidate.clientWidth + 1 && getComputedStyle(candidate).overflowX !== 'visible')
    // The element cut off by the viewport or a clipping ancestor such as a horizontal scroller.
    const rect = element.getBoundingClientRect()
    const shown = visiblePart(rect, element.parentElement ?? element)
    const clippedByAncestor = !shown || shown.width < rect.width - 1
    truncation.push({
      text: (element.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      truncated: overflowsItself || clippedByAncestor,
      overflowsItself,
      clippedByAncestor,
    })
  }

  const scroller = document.scrollingElement ?? document.documentElement
  const bodyStyle = getComputedStyle(document.body)
  return {
    viewport,
    devicePixelRatio: window.devicePixelRatio,
    // Whether content beyond the viewport can be reached by scrolling the page itself.
    page: {
      scrollWidth: scroller.scrollWidth,
      scrollHeight: scroller.scrollHeight,
      horizontalOverflow: scroller.scrollWidth > viewport.width + 1,
      verticalOverflow: scroller.scrollHeight > viewport.height + 1,
      bodyOverflow: `${bodyStyle.overflowX}/${bodyStyle.overflowY}`,
    },
    controls: { count: controls.length, byScope: controlScopes, items: controls.map(describeControl) },
    fonts: {
      root: options.fontRoot ?? 'main',
      distinct: fontSizes.length,
      min: fontSizes.length ? fontSizes[0] : null,
      sizes: fontSizes,
      textNodesBySize: fontCounts,
    },
    regions,
    phrases,
    truncation,
  }
}
