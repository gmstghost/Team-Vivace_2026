/**
 * 항구 검색 상자: 입력하면 아래에 후보 목록이 뜨고, 고르면 onSelect(port)를 부름.
 * 키보드: ↑↓로 이동, Enter로 선택, Esc로 닫기.
 */
import { searchPorts, portLabel, countryName } from '../model/ports.js';

let uid = 0;

export class PortPicker {
  /**
   * @param {HTMLInputElement} input
   * @param {{getPorts: () => Array, onSelect: (port: Object) => void}} opts
   */
  constructor(input, { getPorts, onSelect }) {
    this.input = input;
    this.getPorts = getPorts;
    this.onSelect = onSelect;
    this.port = null;
    this.items = [];
    this.active = -1;

    this.list = document.createElement('ul');
    this.list.className = 'suggest';
    this.list.id = `suggest-${++uid}`;
    this.list.setAttribute('role', 'listbox');
    this.list.hidden = true;
    input.after(this.list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', this.list.id);
    input.autocomplete = 'off';
    input.spellcheck = false;

    input.addEventListener('focus', () => {
      input.select();
      this._update('');
    });
    input.addEventListener('input', () => this._update(input.value));
    input.addEventListener('keydown', (e) => this._key(e));
    input.addEventListener('blur', () => {
      // 목록을 누르는 동안 blur가 먼저 오므로 조금 기다렸다 닫음
      setTimeout(() => {
        this._close();
        this._show();
      }, 150);
    });
    this.list.addEventListener('pointerdown', (e) => e.preventDefault()); // 입력 상자 focus 유지
    this.list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) this._choose(Number(li.dataset.i));
    });
  }

  /** 밖에서 항구를 정할 때 (onSelect는 부르지 않음) */
  set(port) {
    this.port = port;
    this._show();
  }

  _show() {
    if (this.port) this.input.value = `${portLabel(this.port)} · ${countryName(this.port.country)}`;
  }

  _update(query) {
    this.items = searchPorts(this.getPorts(), query, 12);
    this.active = this.items.length ? 0 : -1;
    this._render(query);
  }

  _render(query) {
    this.list.replaceChildren();
    if (!this.items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = query.trim() ? '찾는 항구가 없습니다' : '항구 이름, 나라, UN/LOCODE로 검색';
      this.list.append(li);
    }
    this.items.forEach((p, i) => {
      const li = document.createElement('li');
      li.id = `${this.list.id}-${i}`;
      li.dataset.i = i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === this.active));
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = p.ko ? `${p.ko} ${p.name}` : p.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${countryName(p.country)} · ${p.id.includes('~') ? '' : p.id}`.replace(/ · $/, '');
      li.append(name, meta);
      if (p.major) li.classList.add('major');
      this.list.append(li);
    });
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this._highlight();
  }

  _highlight() {
    [...this.list.children].forEach((li, i) => {
      const on = i === this.active;
      li.classList.toggle('on', on);
      if (li.dataset.i !== undefined) li.setAttribute('aria-selected', String(on));
      if (on) li.scrollIntoView({ block: 'nearest' });
    });
    if (this.active >= 0) this.input.setAttribute('aria-activedescendant', `${this.list.id}-${this.active}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  _key(e) {
    if (this.list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      this._update(this.input.value);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.items.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + d + this.items.length) % this.items.length;
      this._highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.active >= 0) this._choose(this.active);
    } else if (e.key === 'Escape') {
      this._close();
      this._show();
      this.input.blur();
    }
  }

  _choose(i) {
    const port = this.items[i];
    if (!port) return;
    this.port = port;
    this._close();
    this._show();
    this.input.blur();
    this.onSelect(port);
  }

  _close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }
}
