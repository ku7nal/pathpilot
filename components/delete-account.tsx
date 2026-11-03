"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeleteAccount() {
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsCancellation, setNeedsCancellation] = useState(false);

  async function openPortal() {
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = await response.json();
      if (response.ok) window.location.assign(data.url);
      else setMessage(data.error || "The customer portal could not be opened.");
    } catch { setMessage("The customer portal could not be opened."); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setNeedsCancellation(false);
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: confirmation }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) window.location.reload();
      else {
        setMessage(data.error || "Account deletion could not be completed.");
        setNeedsCancellation(Boolean(data.needsCancellation));
        setBusy(false);
      }
    } catch {
      setMessage("Account deletion could not be completed. Try again shortly.");
      setBusy(false);
    }
  }

  return <details className="delete-account">
    <summary>Delete your account</summary>
    <p>This permanently removes your Waypoint workspaces, research, saved resources, and progress. Cancel any current subscription through Lemon Squeezy first. Account deletion does not cancel a subscription.</p>
    <form onSubmit={submit}>
      <label htmlFor="delete-confirmation">Type DELETE to confirm</label>
      <Input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required />
      <Button variant="destructive" type="submit" disabled={busy || confirmation !== "DELETE"}>{busy ? "Deleting account…" : "Permanently delete account"}</Button>
    </form>
    {message && <p role="alert">{message}</p>}
    {needsCancellation && <Button type="button" variant="outline" onClick={() => void openPortal()}>Manage subscription</Button>}
  </details>;
}
