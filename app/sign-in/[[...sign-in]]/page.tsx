import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";

const DEV_BYPASS =
  process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1" ||
  process.env.NODE_ENV === "development";

export default function SignInPage() {
  if (DEV_BYPASS) {
    redirect("/dashboard");
  }
  return (
    <div className="flex h-screen w-full items-center justify-center p-4">
      <div className="glass-card p-4 rounded-xl">
        <SignIn appearance={{ elements: { formButtonPrimary: "bg-primary hover:bg-primary/90" } }} />
      </div>
    </div>
  );
}
