if (!window.__inlineTranslatorLoaded) {
  window.__inlineTranslatorLoaded = true;

  let savedRange = null;
  // Each record: { node, container, full, applied }
  //   full    = the text node's original data
  //   applied = the data we wrote into it
  // React (Facebook etc.) may reset a node's data or swap the node out, so a
  // MutationObserver re-applies our translation whenever that happens.
  const records = [];
  let observer = null;
  let scheduled = false;

  function textNodesIn(range) {
    const root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) return [root];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
    }
    return nodes;
  }

  // A few levels up from the text node, so we can find it again if React
  // replaces the node itself but keeps the surrounding element.
  function containerFor(node) {
    let el = node.parentElement;
    for (let i = 0; i < 3 && el && el.parentElement && el.parentElement !== document.body; i++) {
      el = el.parentElement;
    }
    return el;
  }

  function findNodeWithData(container, data) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.data === data) return walker.currentNode;
    }
    return null;
  }

  function reapply() {
    scheduled = false;
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.node.isConnected) {
        if (r.node.data === r.full && r.applied !== r.full) r.node.data = r.applied;
      } else if (r.container && r.container.isConnected) {
        const fresh = findNodeWithData(r.container, r.full);
        if (fresh) {
          r.node = fresh;
          fresh.data = r.applied;
        }
      } else {
        records.splice(i, 1); // post was unmounted (scrolled away / navigated)
      }
    }
    if (!records.length) stopObserving();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(reapply);
  }

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  function stopObserving() {
    if (observer) observer.disconnect();
    observer = null;
  }

  function replaceSelection(text) {
    if (!savedRange) return;
    const nodes = textNodesIn(savedRange);
    let placed = false;
    for (const node of nodes) {
      const start = node === savedRange.startContainer ? savedRange.startOffset : 0;
      const end = node === savedRange.endContainer ? savedRange.endOffset : node.data.length;
      if (!node.data.slice(start, end).trim()) continue;
      const full = node.data;
      const applied = full.slice(0, start) + (placed ? "" : text) + full.slice(end);
      records.push({ node, container: containerFor(node), full, applied });
      node.data = applied;
      placed = true;
    }
    window.getSelection().removeAllRanges();
    savedRange = null;
    if (records.length) startObserving();
  }

  const FONT_FAMILY = "ReadMEasy Bornomala";
  const fontSpans = [];
  let fontLoading = null;

  // Loaded via the FontFace API from raw bytes so the page's CSP can't block it.
  function loadFont() {
    if (!fontLoading) {
      fontLoading = fetch(chrome.runtime.getURL("fonts/Bornomala-Regular.ttf"))
        .then((r) => r.arrayBuffer())
        .then((buf) => new FontFace(FONT_FAMILY, buf).load())
        .then((face) => document.fonts.add(face))
        .catch((e) => {
          fontLoading = null;
          throw e;
        });
    }
    return fontLoading;
  }

  async function applyFont() {
    if (!savedRange) return;
    await loadFont();
    const range = savedRange;
    for (const node of textNodesIn(range)) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      if (!node.data.slice(start, end).trim()) continue;
      const r = document.createRange();
      r.setStart(node, start);
      r.setEnd(node, end);
      const span = document.createElement("span");
      span.style.setProperty("font-family", `"${FONT_FAMILY}"`, "important");
      span.style.setProperty("font-size", "1.1em", "important");
      span.style.setProperty("letter-spacing", "0.06em", "important");
      span.style.setProperty("line-height", "1.6", "important");
      r.surroundContents(span);
      fontSpans.push(span);
    }
    window.getSelection().removeAllRanges();
    savedRange = null;
  }

  function unwrapFont() {
    for (const span of fontSpans) {
      if (span.isConnected) span.replaceWith(...span.childNodes);
    }
    fontSpans.length = 0;
  }

  function restore() {
    unwrapFont();
    stopObserving();
    for (const r of records) {
      if (r.node.isConnected && r.node.data === r.applied) r.node.data = r.full;
    }
    records.length = 0;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "getSelection") {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        savedRange = null;
        sendResponse({ text: "", translated: (records.length > 0 || fontSpans.length > 0) });
      } else {
        savedRange = sel.getRangeAt(0).cloneRange();
        sendResponse({ text: sel.toString(), translated: (records.length > 0 || fontSpans.length > 0) });
      }
    } else if (msg.type === "replace") {
      replaceSelection(msg.text);
      sendResponse({ ok: true });
    } else if (msg.type === "font") {
      applyFont().then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, error: String(e) })
      );
      return true; // async response
    } else if (msg.type === "restore") {
      restore();
      sendResponse({ ok: true });
    }
  });
}
