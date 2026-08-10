export default function AuthCodeErrorPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">That sign-in link didn&apos;t work</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may have expired or already been used. Go back to{" "}
        <a href="/login" className="underline">
          the sign-in page
        </a>{" "}
        and request a new one.
      </p>
    </main>
  );
}
