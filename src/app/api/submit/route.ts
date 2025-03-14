import  { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const { prompt } = await request.json();
  console.log(prompt);

  return NextResponse.json({ message: 'Prompt submitted successfully' });
}
