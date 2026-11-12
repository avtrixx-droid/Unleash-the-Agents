// Types for globals provided by the Supabase edge runtime.
declare global {
  const Supabase: {
    ai: {
      Session: new (model: "gte-small") => {
        run(input: string, opts: { mean_pool: boolean; normalize: boolean }): Promise<unknown>;
      };
    };
  };
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
}
export {};
