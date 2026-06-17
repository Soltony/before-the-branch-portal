import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function validationErrorResponse(err: ZodError) {
  // Return only the validation issues; do not include stacks or internal messages
  return NextResponse.json({ error: 'Invalid request', issues: err.errors }, { status: 400 });
}

export function handleApiError(err: any, context?: { operation?: string; info?: any }) {
  try {
    // Log full error details server-side for diagnostics
    const prefix = context?.operation ? `[${context.operation}] ` : '';
    console.error(prefix + 'API error:', { message: err?.message, stack: err?.stack, info: context?.info });
  } catch (loggingError) {
    // swallow logging errors
    console.error('Error while logging an API error', loggingError);
  }

  // For clients, return a generic message that does not expose internals
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}

export function badRequest(message = 'Bad Request') {
  return NextResponse.json({ error: message }, { status: 400 });
}
