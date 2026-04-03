import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex h-screen w-full items-center justify-center p-4">
      <div className="glass-card p-4 rounded-xl">
        <SignUp appearance={{ elements: { formButtonPrimary: "bg-primary hover:bg-primary/90" } }} />
      </div>
    </div>
  );
}
