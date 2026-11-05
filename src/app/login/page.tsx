import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { AuthSplit } from "@/components/marketing/AuthSplit";
import { LoginForm } from "./LoginForm";
import { safeNext } from "@/lib/navigation";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getViewer()) redirect(next);
  return (
    <AuthSplit
      title="Sign in"
      sub={
        <>
          Your ride files are read in your browser. <Link href="/demo" style={{ color: "var(--accent)", fontWeight: 600 }}>See sample rides first</Link>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthSplit>
  );
}
