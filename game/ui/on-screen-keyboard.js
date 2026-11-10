/*
 * An on-screen keyboard for typing a username with a pad (or a mouse): letters, digits, space,
 * underscore, hyphen, backspace and DONE. Every key is a button, so the pad's menu navigation
 * (D-pad moves the highlight, A presses) works on it without special code.
 */

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '_'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '-'],
];

function key(label, onPress, className = 'panel osk-key') {
  const element = document.createElement('button');
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onPress();
  });
  return element;
}

export class OnScreenKeyboard {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = { overlay: $('overlay-osk'), text: $('osk-text'), keys: $('osk-keys') };
    this.isOpen = false;
    this.input = null;
    this.maxLength = 16;
    this.lower = false;
    this.letterKeys = [];
    this.onDone = () => {};
    this.el.overlay.addEventListener('click', (event) => event.stopPropagation());
    this._build();
  }

  /** Edit `input` (a text field). `onDone` runs when the player presses DONE. */
  open(input, { maxLength = 16, onDone = () => {} } = {}) {
    this.input = input;
    this.maxLength = maxLength;
    this.onDone = onDone;
    this.isOpen = true;
    this.el.overlay.style.display = 'flex';
    this._showText();
  }

  close() {
    this.isOpen = false;
    this.el.overlay.style.display = 'none';
  }

  /** B or Escape: close and keep what was typed. */
  cancel() {
    this.close();
  }

  _build() {
    const { keys } = this.el;
    for (const row of ROWS) {
      const line = document.createElement('div');
      line.className = 'osk-row';
      for (const char of row) {
        const element = key(char, () => this._type(char));
        if (/[A-Z]/.test(char)) this.letterKeys.push({ element, char });
        line.appendChild(element);
      }
      keys.appendChild(line);
    }
    const last = document.createElement('div');
    last.className = 'osk-row';
    last.appendChild(key('aA', () => this._toggleCase()));
    last.appendChild(key('SPACE', () => this._type(' '), 'panel osk-key osk-wide'));
    last.appendChild(key('⌫', () => this._backspace()));
    last.appendChild(key('DONE', () => this._done(), 'panel osk-key osk-wide osk-done'));
    keys.appendChild(last);
  }

  _type(char) {
    if (!this.input || this.input.value.length >= this.maxLength) return;
    const letter = /[A-Z]/.test(char);
    this._set(this.input.value + (letter && this.lower ? char.toLowerCase() : char));
  }

  _backspace() {
    if (this.input) this._set(this.input.value.slice(0, -1));
  }

  _toggleCase() {
    this.lower = !this.lower;
    for (const { element, char } of this.letterKeys) element.textContent = this.lower ? char.toLowerCase() : char;
  }

  _done() {
    this.close();
    this.onDone();
  }

  /** Write the text and tell the page (its username check listens for "input"). */
  _set(value) {
    this.input.value = value;
    this.input.dispatchEvent?.(new Event('input', { bubbles: true }));
    this._showText();
  }

  _showText() {
    this.el.text.textContent = this.input ? this.input.value || ' ' : '';
  }
}
