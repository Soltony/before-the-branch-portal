import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = body || {};
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'password required' }, { status: 400 });
    }

    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!res.ok) {
      // If the external API fails, don't block signup; treat as not pwned
      return NextResponse.json({ pwned: false });
    }

    const text = await res.text();
    const found = text.split('\n').some(line => line.split(':')[0] === suffix);
    return NextResponse.json({ pwned: Boolean(found) });
  } catch (err) {
    console.error('pwned-password check failed', err);
    return NextResponse.json({ pwned: false });
  }
}
