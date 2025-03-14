'use client';

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Home() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (formData: FormData): Promise<void> => {
    setIsSubmitting(true);
    setError(null);

    try {
      const prompt = formData.get('prompt')?.toString();
      if (!prompt) return

      await fetch('/api/submit', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Something went wrong';
      setError(errorMessage);
      console.error('Submission error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <form
        action={handleSubmit}
        className="flex w-full max-w-sm flex-col items-center space-y-4"
      >
        <div className="flex w-full items-center space-x-2">
          <Input
            type="text"
            name="prompt"
            placeholder="Enter prompt"
            className="flex-1"
            disabled={isSubmitting}
          />
          <Button
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </Button>
        </div>
        {error && (
          <p className="text-red-500 text-sm">{error}</p>
        )}
      </form>
    </div>
  );
}
