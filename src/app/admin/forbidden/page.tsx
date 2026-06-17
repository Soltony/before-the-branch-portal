import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="max-w-lg w-full bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-2xl font-semibold mb-2">Unauthorized</h1>
        <p className="text-sm text-muted-foreground mb-6">You do not have permission to view this page.</p>
        <div className="flex justify-center gap-3">
          <Link
            href="/admin"
            className="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
