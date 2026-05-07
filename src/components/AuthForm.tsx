import type { FormEvent } from 'react'

type AuthFormProps = {
  email: string
  username: string
  password: string
  authError: string | null
  authNotice: string | null
  authLoading: boolean
  onEmailChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSignIn: (event: FormEvent<HTMLFormElement>) => void
  onSignUp: () => void
  onForgotPassword: () => void
}

export function AuthForm({
  email,
  username,
  password,
  authError,
  authNotice,
  authLoading,
  onEmailChange,
  onUsernameChange,
  onPasswordChange,
  onSignIn,
  onSignUp,
  onForgotPassword,
}: AuthFormProps) {
  return (
    <form className="mt-4 space-y-2" onSubmit={onSignIn}>
      <input
        required
        type="email"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
        placeholder="Email"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
      />
      <input
        type="text"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
        placeholder="Username (for sign up)"
        value={username}
        onChange={(event) => onUsernameChange(event.target.value)}
      />
      <input
        required
        type="password"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
        placeholder="Password"
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
      />
      {authError ? <p className="text-xs text-rose-300">{authError}</p> : null}
      {authNotice ? <p className="text-xs text-emerald-300">{authNotice}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={authLoading}
          type="submit"
          className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Sign in
        </button>
        <button
          disabled={authLoading}
          type="button"
          className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={onSignUp}
        >
          Sign up
        </button>
      </div>
      <button
        disabled={authLoading}
        type="button"
        className="w-full rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-50"
        onClick={onForgotPassword}
      >
        Forgot password
      </button>
    </form>
  )
}
