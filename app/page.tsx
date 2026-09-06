import { chatGPTSignOutPath, requireChatGPTUser } from './chatgpt-auth';
import { AppShell } from './app-shell';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await requireChatGPTUser('/');

  return (
    <AppShell
      authenticatedUser={{ displayName: user.displayName, email: user.email }}
      signOutPath={chatGPTSignOutPath('/')}
    />
  );
}
