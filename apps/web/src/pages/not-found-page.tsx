import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <section className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-muted-foreground font-mono text-sm">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <Button asChild variant="outline">
        <Link to="/">Back to videos</Link>
      </Button>
    </section>
  );
}
