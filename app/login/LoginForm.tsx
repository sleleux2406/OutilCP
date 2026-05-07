"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2, LogIn } from "lucide-react";

interface Props {
  redirectTo: string;
}

export function LoginForm({ redirectTo }: Props) {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, null);
  const prefilledEmail = state && !state.ok ? state.email ?? "" : "";

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          defaultValue={prefilledEmail}
          aria-invalid={state && !state.ok ? true : undefined}
        />
      </div>

      <div>
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={1}
          maxLength={256}
          aria-invalid={state && !state.ok ? true : undefined}
        />
      </div>

      {state && !state.ok && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <SubmitButton />

      <p className="text-[11px] text-muted-foreground text-center pt-2">
        Les tentatives de connexion sont limitées et journalisées.
      </p>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Connexion...
        </>
      ) : (
        <>
          <LogIn className="h-4 w-4" />
          Se connecter
        </>
      )}
    </Button>
  );
}
