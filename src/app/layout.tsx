import type {Metadata} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/hooks/use-auth';
import { headers } from 'next/headers';

export const metadata: Metadata = {
  title: 'LoanFlow',
  description: 'A mini-app for handling loan applications and processing.',
};

//const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  
  return (
    <html lang="en" className={`font-body h-full`}>
      <head>
        
      </head>
      <body className="font-body antialiased h-full bg-background">
        <AuthProvider>
            {children}  
            <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
