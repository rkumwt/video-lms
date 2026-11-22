import { Construction } from 'lucide-react';

export function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  return (
    <section className="flex flex-col items-center gap-3 py-16 text-center">
      <Construction className="text-muted-foreground size-10" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm">Coming in Phase {phase}.</p>
    </section>
  );
}
