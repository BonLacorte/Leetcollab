import "./globals.css";
import { AuthProvider } from "../components/auth-provider";
import { SocketProvider } from "../components/socket-provider";
import { ThemeProvider } from "../components/theme-provider";

export const metadata = {
  title: "LeetCollab",
  description: "Solve coding challenges together.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <AuthProvider><SocketProvider>{children}</SocketProvider></AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
