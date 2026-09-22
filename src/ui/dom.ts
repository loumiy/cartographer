type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Tiny hyperscript helper: h('button', { class: 'btn', onclick }, 'Set sail'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (k === 'value' && 'value' in el) {
        (el as HTMLInputElement).value = String(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function button(label: Child | Child[], onClick: () => void, opts: { kind?: 'primary' | 'secondary' | 'risk' | 'quiet'; disabled?: boolean | string; title?: string; class?: string } = {}) {
  const reason = typeof opts.disabled === 'string' ? opts.disabled : undefined;
  return h(
    'button',
    {
      type: 'button',
      class: `btn btn-${opts.kind ?? 'secondary'}${opts.class ? ` ${opts.class}` : ''}`,
      disabled: !!opts.disabled,
      title: reason ?? opts.title,
      onclick: onClick,
    },
    ...(Array.isArray(label) ? label : [label]),
  );
}
