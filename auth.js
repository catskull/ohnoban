const PRF_SALT = new TextEncoder().encode("ohnoban-prf-v1");
const PASSKEY_KEY = "ohnoban-passkey";

export const b64u = {
  encode: buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: str => {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
  }
};

export function getStoredPasskey() {
  const raw = localStorage.getItem(PASSKEY_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function forgetPasskey() {
  localStorage.removeItem(PASSKEY_KEY);
}

export async function registerPasskey() {
  if (!window.PublicKeyCredential) throw new Error("WebAuthn not supported in this browser");

  const userId = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "ohnoban" },
      user: { id: userId, name: "ohnoban-user", displayName: "ohnoban user" },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" }
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: {} }
    }
  });

  if (!cred.getClientExtensionResults().prf?.enabled) {
    throw new Error("Authenticator does not support PRF");
  }

  localStorage.setItem(PASSKEY_KEY, JSON.stringify({
    credentialId: b64u.encode(cred.rawId),
    userId: b64u.encode(userId),
    createdAt: new Date().toISOString()
  }));
}

export async function authenticate() {
  const stored = getStoredPasskey();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = {
    challenge,
    userVerification: "required",
    extensions: { prf: { eval: { first: PRF_SALT } } }
  };
  if (stored) {
    publicKey.allowCredentials = [{ id: b64u.decode(stored.credentialId), type: "public-key" }];
  }

  const cred = await navigator.credentials.get({ publicKey });

  const prf = cred.getClientExtensionResults().prf?.results?.first;
  if (!prf) throw new Error("PRF result missing — authenticator may not support PRF");

  if (!stored) {
    localStorage.setItem(PASSKEY_KEY, JSON.stringify({
      credentialId: b64u.encode(cred.rawId),
      userId: b64u.encode(cred.response.userHandle || new Uint8Array()),
      createdAt: new Date().toISOString(),
      discovered: true
    }));
  }

  return new Uint8Array(prf);
}

let ui = null;

export function refreshAuthUI() {
  if (!ui) return;
  const stored = getStoredPasskey();
  ui.status.textContent = stored
    ? `Registered (${stored.credentialId.slice(0, 12)}\u2026)`
    : "Not registered on this browser";
  ui.registerBtn.disabled = !!stored;
  ui.testAuthBtn.textContent = stored ? "Test authentication" : "Sign in with passkey";
  ui.forgetBtn.disabled = !stored;
}

export function initAuthUI() {
  ui = {
    status: document.getElementById("auth-status"),
    output: document.getElementById("auth-output"),
    registerBtn: document.getElementById("register-passkey-btn"),
    testAuthBtn: document.getElementById("test-auth-btn"),
    forgetBtn: document.getElementById("forget-passkey-btn")
  };

  const showOutput = text => {
    ui.output.hidden = false;
    ui.output.textContent = text;
  };

  ui.registerBtn.addEventListener("click", async () => {
    try {
      await registerPasskey();
      refreshAuthUI();
      showOutput("Passkey registered. Click \"Test authentication\" to derive the PRF key.");
    } catch (e) {
      showOutput(`Registration failed: ${e.message}`);
    }
  });

  ui.testAuthBtn.addEventListener("click", async () => {
    try {
      const key = await authenticate();
      refreshAuthUI();
      showOutput(`PRF key (${key.length} bytes): ${b64u.encode(key)}`);
    } catch (e) {
      showOutput(`Authentication failed: ${e.message}`);
    }
  });

  ui.forgetBtn.addEventListener("click", () => {
    if (!confirm("Forget passkey? The credential will remain on your device but ohnoban will no longer reference it.")) return;
    forgetPasskey();
    refreshAuthUI();
    ui.output.hidden = true;
  });

  refreshAuthUI();
}
