import { getChatGPTUser } from './chatgpt-auth';
import { AppShell } from './app-shell';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();

  return (
    <AppShell
      authenticatedUser={
        user ? { displayName: user.displayName, email: user.email } : null
      }
    />
  );
}
