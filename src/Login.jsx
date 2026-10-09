import { useState } from "react";
import "./Login.css";

/**
 * Tela de autenticação da Minha Carteira.
 * Passe onLogin, onRegister e onForgotPassword para conectar ao Supabase Auth.
 *
 * Exemplo:
 * <Login
 *   onLogin={({ email, password }) => supabase.auth.signInWithPassword({ email, password })}
 *   onRegister={({ name, email, password }) => ...}
 *   onForgotPassword={({ email }) => supabase.auth.resetPasswordForEmail(email)}
 * />
 */
export default function Login({
  onLogin,
  onRegister,
  onForgotPassword,
  onGoogleLogin,
}) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const resetMessages = () => {
    setMessage("");
    setError("");
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    resetMessages();
  };

  async function handleSubmit(event) {
    event.preventDefault();
    resetMessages();

    if (!email.trim()) {
      setError("Informe seu e-mail.");
      return;
    }

    if (mode !== "forgot" && !password) {
      setError("Informe sua senha.");
      return;
    }

    if (mode === "register") {
      if (name.trim().length < 2) {
        setError("Informe seu nome completo.");
        return;
      }
      if (password.length < 8) {
        setError("A senha deve ter pelo menos 8 caracteres.");
        return;
      }
      if (password !== confirmPassword) {
        setError("As senhas não coincidem.");
        return;
      }
      if (!acceptedTerms) {
        setError("Você precisa aceitar os termos para continuar.");
        return;
      }
    }

    const handler =
      mode === "login"
        ? onLogin
        : mode === "register"
          ? onRegister
          : onForgotPassword;

    if (!handler) {
      setError("Esta ação ainda não foi conectada ao Supabase.");
      return;
    }

    setLoading(true);
    try {
      const result =
        mode === "login"
          ? await handler({ email: email.trim(), password, remember })
          : mode === "register"
            ? await handler({ name: name.trim(), email: email.trim(), password })
            : await handler({ email: email.trim() });

      if (result?.error) throw result.error;

      if (mode === "login") {
        setMessage("Login realizado. Carregando sua carteira…");
      } else if (mode === "register") {
        setMessage(
          result?.data?.user?.identities?.length === 0
            ? "Este e-mail já pode estar cadastrado. Tente entrar ou recuperar a senha."
            : "Cadastro enviado! Verifique seu e-mail para confirmar a conta, se a confirmação estiver habilitada."
        );
      } else {
        setMessage("Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.");
      }
    } catch (err) {
      const text = String(err?.message || "");
      if (/invalid login credentials/i.test(text)) {
        setError("E-mail ou senha incorretos.");
      } else if (/email not confirmed/i.test(text)) {
        setError("Confirme seu e-mail antes de entrar.");
      } else if (/user already registered/i.test(text)) {
        setError("Este e-mail já possui uma conta. Entre ou recupere sua senha.");
      } else {
        setError(text || "Não foi possível concluir a operação. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  }

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";

  return (
    <main className="auth-page">
      <section className="auth-showcase" aria-label="Sobre o aplicativo">
        <a className="brand brand-light" href="/" aria-label="Minha Carteira, início">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <path d="M6 39V29h9v10H6Zm13 0V20h9v19h-9Zm13 0V11h9v28h-9Z" fill="currentColor" opacity=".92" />
              <path d="m7 22 13-8 8 2L42 4M31 4h11v11" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-copy">
            <strong>Minha Carteira</strong>
            <small>Investimentos inteligentes</small>
          </span>
        </a>

        <div className="showcase-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> SEU DINHEIRO, SOB SEU CONTROLE</span>
          <h1>Invista com clareza.<br /><em>Planeje seu futuro.</em></h1>
          <p>Acompanhe seus ativos, entenda seu patrimônio e tome decisões com mais informação.</p>

          <div className="benefit-list">
            <div className="benefit">
              <span className="benefit-icon" aria-hidden="true">↗</span>
              <span><b>Acompanhe seu desempenho</b><small>Veja a evolução da sua carteira.</small></span>
            </div>
            <div className="benefit">
              <span className="benefit-icon" aria-hidden="true">▥</span>
              <span><b>Organize seus investimentos</b><small>Registre ativos e movimentações.</small></span>
            </div>
            <div className="benefit">
              <span className="benefit-icon" aria-hidden="true">⌑</span>
              <span><b>Seus dados protegidos</b><small>Acesso individual à sua carteira.</small></span>
            </div>
          </div>
        </div>

        <div className="showcase-bottom">
          <div className="mini-chart" aria-hidden="true">
            <div className="chart-label"><span>EVOLUÇÃO DA CARTEIRA</span><b>+12,45%</b></div>
            <svg viewBox="0 0 360 82" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#39e6a0" stopOpacity=".28" />
                  <stop offset="100%" stopColor="#39e6a0" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 68 C18 65 20 50 37 56 S59 62 75 45 S98 54 113 37 S139 46 151 32 S172 42 188 28 S208 37 222 21 S244 31 258 16 S282 27 299 13 S326 17 360 3 V82 H0Z" fill="url(#chartFill)" />
              <path d="M0 68 C18 65 20 50 37 56 S59 62 75 45 S98 54 113 37 S139 46 151 32 S172 42 188 28 S208 37 222 21 S244 31 258 16 S282 27 299 13 S326 17 360 3" fill="none" stroke="#39e6a0" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
          <p>Pequenos passos hoje.<br /><strong>Mais possibilidades amanhã.</strong></p>
          <span className="showcase-footnote">INVESTIR ENVOLVE RISCOS. INFORME-SE ANTES DE INVESTIR.</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <a className="brand brand-dark mobile-brand" href="/" aria-label="Minha Carteira, início">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none">
                <path d="M6 39V29h9v10H6Zm13 0V20h9v19h-9Zm13 0V11h9v28h-9Z" fill="currentColor" opacity=".92" />
                <path d="m7 22 13-8 8 2L42 4M31 4h11v11" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="brand-copy"><strong>Minha Carteira</strong><small>Investimentos inteligentes</small></span>
          </a>

          <div className="auth-heading">
            <span className="auth-kicker">{isRegister ? "COMECE POR AQUI" : isForgot ? "RECUPERE O ACESSO" : "BOM TER VOCÊ DE VOLTA"}</span>
            <h2>{isRegister ? "Crie sua conta" : isForgot ? "Esqueceu a senha?" : "Bem-vindo de volta!"}</h2>
            <p>
              {isRegister
                ? "Preencha seus dados para começar a organizar seus investimentos."
                : isForgot
                  ? "Vamos enviar um link para você redefinir sua senha."
                  : "Entre para acessar sua carteira de investimentos."}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isRegister && (
              <label className="field">
                <span>Nome completo</span>
                <span className="input-wrap">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>
                  <input autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Como podemos te chamar?" required />
                </span>
              </label>
            )}

            <label className="field">
              <span>E-mail</span>
              <span className="input-wrap">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>
                <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" required />
              </span>
            </label>

            {!isForgot && (
              <label className="field">
                <span>Senha</span>
                <span className="input-wrap">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={isRegister ? "Mínimo de 8 caracteres" : "Digite sua senha"}
                    minLength={isRegister ? 8 : undefined}
                    required
                  />
                  <button className="password-toggle" type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3 21 21M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5.5 0 9 7 9 7a15 15 0 0 1-3.1 3.8M6.2 6.2C4.1 7.5 3 12 3 12s3.5 7 9 7c1.2 0 2.3-.3 3.3-.8" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </span>
              </label>
            )}

            {isRegister && (
              <>
                <label className="field">
                  <span>Confirmar senha</span>
                  <span className="input-wrap">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                    <input type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Digite a senha novamente" required />
                  </span>
                </label>
                <label className="check-row terms-row">
                  <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} />
                  <span>Li e aceito os <a href="/termos" target="_blank" rel="noreferrer">Termos de Uso</a> e a <a href="/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.</span>
                </label>
              </>
            )}

            {mode === "login" && (
              <div className="form-options">
                <label className="check-row">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                  <span>Manter conectado</span>
                </label>
                <button type="button" className="text-button" onClick={() => switchMode("forgot")}>Esqueceu a senha?</button>
              </div>
            )}

            {error && <div className="form-alert error-alert" role="alert">{error}</div>}
            {message && <div className="form-alert success-alert" role="status">{message}</div>}

            <button className="submit-button" type="submit" disabled={loading}>
              {loading ? <span className="spinner" /> : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {isRegister ? <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M19 8v6M16 11h6" /></> : isForgot ? <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></> : <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>}
                </svg>
              )}
              {loading ? "Aguarde..." : isRegister ? "Criar minha conta" : isForgot ? "Enviar link de recuperação" : "Entrar na minha carteira"}
            </button>
          </form>

          {mode !== "forgot" && (
            <>
              <div className="separator"><span /> <small>ou</small> <span /></div>
              {onGoogleLogin && (
                <button className="google-button" type="button" onClick={async () => {
                  resetMessages();
                  setLoading(true);
                  try {
                    const result = await onGoogleLogin();
                    if (result?.error) throw result.error;
                  } catch (err) {
                    setError(err?.message || "Não foi possível entrar com Google.");
                  } finally {
                    setLoading(false);
                  }
                }} disabled={loading}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.4 3-7.3Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6C7.2 7.8 9.4 6 12 6Z"/></svg>
                  Continuar com Google
                </button>
              )}
              <p className="switch-mode">
                {isRegister ? "Já tem uma conta?" : "Ainda não tem uma conta?"}{" "}
                <button type="button" onClick={() => switchMode(isRegister ? "login" : "register")}>
                  {isRegister ? "Entrar" : "Criar conta"}
                </button>
              </p>
            </>
          )}

          {isForgot && (
            <p className="switch-mode"><button type="button" onClick={() => switchMode("login")}>← Voltar para o login</button></p>
          )}

          <div className="security-note">
            <span className="security-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            </span>
            <span><b>Seus dados merecem cuidado.</b><small>Autenticação segura com Supabase.</small></span>
          </div>

          <footer className="auth-footer">
            <span>© {new Date().getFullYear()} Minha Carteira</span>
            <span><i /> Ambiente protegido</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
