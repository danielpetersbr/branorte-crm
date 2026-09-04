import { supabase } from '@/lib/controle-supabase/client';

function parseUserAgent(ua: string) {
  let browser = 'Desconhecido';
  let os = 'Desconhecido';
  let deviceType = 'Desktop';

  // OS detection
  if (/Android/i.test(ua)) { os = 'Android'; deviceType = 'Mobile'; }
  else if (/iPhone|iPad|iPod/i.test(ua)) { os = 'iOS'; deviceType = /iPad/i.test(ua) ? 'Tablet' : 'Mobile'; }
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  // Browser detection
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  return { browser, os, deviceType };
}

export async function recordLogin(userId: string) {
  try {
    const ua = navigator.userAgent;
    const { browser, os, deviceType } = parseUserAgent(ua);

    await supabase.from('login_history' as any).insert({
      user_id: userId,
      user_agent: ua,
      device_type: deviceType,
      browser,
      os,
    });
  } catch (err) {
    console.warn('[LoginHistory] Erro ao registrar login:', err);
  }
}
