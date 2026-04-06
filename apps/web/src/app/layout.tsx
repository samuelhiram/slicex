import './globals.css';

export const metadata = {
  title: 'SliceX'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>SliceX</title>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
