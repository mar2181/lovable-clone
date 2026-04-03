export default function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-zinc-950 text-foreground overflow-hidden">
      {children}
    </div>
  );
}
