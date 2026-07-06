/**
 * VRSystemKeyboard — thin wrapper over the Meta Quest Browser system keyboard
 * for WebXR sessions.
 * https://developers.meta.com/horizon/documentation/web/webxr-keyboard/
 *
 * The system keyboard has no API of its own: it is summoned by calling
 * `focus()` on a real DOM `<input>` while an immersive session is active
 * (Browser ≥ 26.1, advertised via `session.isSystemKeyboardSupported`), and it
 * has no key events — the only contract is:
 *
 *  • the input element's `value` (each show is a fresh editing session; the
 *    first key press replaces the entire existing value);
 *  • `oninput` firing as the user types;
 *  • the XRSession visibility lifecycle: `visible-blurred` while the keyboard
 *    is up, back to `visible` when the user dismisses it.
 *
 * The wrapper owns a single hidden input appended to the DOM for the lifetime
 * of the session. It is `position:fixed` at the viewport origin — the Meta
 * docs warn that an off-viewport input makes the page scroll to it as the user
 * types, which would leave the underlying 2D page scrolled after session exit.
 */

interface IVRKeyboardOpenOptions {
  /** Text to pre-fill (note: the first key press replaces it wholesale). */
  initial: string;
  /** Fires on every change while the user types. */
  onInput: (text: string) => void;
  /** Fires once when the user dismisses the keyboard. */
  onCommit: (text: string) => void;
}

export class VRSystemKeyboard {
  private session: XRSession | null = null;
  private input: HTMLInputElement | null = null;
  private active = false;
  // The keyboard-up visibility blur has been observed for the current open —
  // required before a return to "visible" is read as "keyboard dismissed"
  // (other causes of visible-blurred, e.g. the system menu, don't set it
  // because no open() is pending).
  private blurSeen = false;
  private onInput: ((text: string) => void) | null = null;
  private onCommit: ((text: string) => void) | null = null;

  /** Attach to the live immersive session (call from session init). */
  setSession(session: XRSession | null) {
    this.session?.removeEventListener(
      "visibilitychange",
      this.onVisibilityChange
    );
    this.session = session;
    session?.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  /** Whether the UA can show a system keyboard inside the current session. */
  get supported(): boolean {
    // Not yet in the TS WebXR types — Meta extension attribute.
    return !!(this.session as { isSystemKeyboardSupported?: boolean } | null)
      ?.isSystemKeyboardSupported;
  }

  /** True from open() until the user dismisses the keyboard. */
  get isOpen(): boolean {
    return this.active;
  }

  /**
   * Summon the system keyboard. Returns false (and does nothing) when the
   * session's UA has no WebXR keyboard support, so callers can surface a hint.
   */
  open(opts: IVRKeyboardOpenOptions): boolean {
    if (!this.supported) return false;
    const input = this.ensureInput();
    this.onInput = opts.onInput;
    this.onCommit = opts.onCommit;
    input.value = opts.initial;
    this.active = true;
    this.blurSeen = false;
    input.focus();
    return true;
  }

  /** Programmatically cancel an open keyboard (e.g. leaving the lobby). */
  close() {
    if (!this.active) return;
    this.active = false;
    this.blurSeen = false;
    this.input?.blur();
  }

  /** Tear down the DOM input + listeners (call on session end). */
  dispose() {
    this.close();
    this.setSession(null);
    if (this.input) {
      this.input.oninput = null;
      this.input.remove();
      this.input = null;
    }
    this.onInput = null;
    this.onCommit = null;
  }

  private ensureInput(): HTMLInputElement {
    if (this.input) return this.input;
    const input = document.createElement("input");
    input.type = "text";
    input.enterKeyHint = "search";
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.setAttribute("aria-hidden", "true");
    // Present in the DOM (required for focus + keyboard routing) but invisible
    // and inert to the 2D page. Fixed at the origin so typing never scrolls
    // the underlying page (see module docs).
    Object.assign(input.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "1px",
      height: "1px",
      opacity: "0",
      border: "0",
      padding: "0",
      pointerEvents: "none",
    });
    input.oninput = () => {
      if (this.active) this.onInput?.(input.value);
    };
    document.body.appendChild(input);
    this.input = input;
    return input;
  }

  private onVisibilityChange = () => {
    const state = this.session?.visibilityState;
    if (state === "visible-blurred") {
      // Keyboard (or another system layer) is up over the session.
      if (this.active) this.blurSeen = true;
      return;
    }
    if (state === "visible" && this.active && this.blurSeen) {
      // Keyboard dismissed — commit whatever was typed.
      this.active = false;
      this.blurSeen = false;
      const text = this.input?.value ?? "";
      this.input?.blur();
      this.onCommit?.(text);
    }
  };
}
