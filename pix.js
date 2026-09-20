// Utilitários de cobrança Pix estática (BR Code).
// O sistema gera a solicitação, mas não consulta nem confirma o pagamento.
(function () {
  const encoder = new TextEncoder();

  const byteLength = (value) => encoder.encode(String(value)).length;

  const field = (id, value) => {
    const text = String(value);
    const length = byteLength(text);
    if (length > 99) throw new Error(`O campo Pix ${id} excedeu o limite permitido.`);
    return `${id}${String(length).padStart(2, '0')}${text}`;
  };

  const onlyDigits = (value) => String(value).replace(/\D/g, '');

  const hasRepeatedDigits = (value) => /^(\d)\1+$/.test(value);

  function isValidCpf(value) {
    const cpf = onlyDigits(value);
    if (cpf.length !== 11 || hasRepeatedDigits(cpf)) return false;

    const calculateDigit = (base, factor) => {
      let total = 0;
      for (const digit of base) total += Number(digit) * factor--;
      const remainder = (total * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };

    const firstDigit = calculateDigit(cpf.slice(0, 9), 10);
    const secondDigit = calculateDigit(cpf.slice(0, 10), 11);
    return firstDigit === Number(cpf[9]) && secondDigit === Number(cpf[10]);
  }

  function isValidCnpj(value) {
    const cnpj = onlyDigits(value);
    if (cnpj.length !== 14 || hasRepeatedDigits(cnpj)) return false;

    const calculateDigit = (base, weights) => {
      const total = base.split('').reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0);
      const remainder = total % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };

    const firstDigit = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const secondDigit = calculateDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return firstDigit === Number(cnpj[12]) && secondDigit === Number(cnpj[13]);
  }

  function normalizeKey(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return { valid: false, error: 'Informe a chave Pix do dominador.' };

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && raw.length <= 77) {
      return { valid: true, key: raw, type: 'E-mail' };
    }

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
      return { valid: true, key: raw, type: 'Chave aleatória' };
    }

    if (raw.startsWith('+')) {
      const digits = onlyDigits(raw);
      if (digits.length >= 12 && digits.length <= 15) {
        return { valid: true, key: `+${digits}`, type: 'Telefone' };
      }
      return { valid: false, error: 'Telefone Pix inválido. Use o formato +55 com DDD e número.' };
    }

    if (/^[\d()./\s-]+$/.test(raw) && raw.includes('(')) {
      const digits = onlyDigits(raw);
      if (digits.length === 10 || digits.length === 11) {
        return { valid: true, key: `+55${digits}`, type: 'Telefone' };
      }
    }

    const digits = onlyDigits(raw);
    if (digits.length === 11) {
      return isValidCpf(digits)
        ? { valid: true, key: digits, type: 'CPF' }
        : { valid: false, error: 'O CPF informado não é válido.' };
    }

    if (digits.length === 14) {
      return isValidCnpj(digits)
        ? { valid: true, key: digits, type: 'CNPJ' }
        : { valid: false, error: 'O CNPJ informado não é válido.' };
    }

    return {
      valid: false,
      error: 'Chave Pix inválida. Use CPF, CNPJ, e-mail, telefone com +55 ou chave aleatória.',
    };
  }

  const sanitizeEmvText = (value, maxLength) =>
    String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 ]/g, '')
      .trim()
      .toUpperCase()
      .slice(0, maxLength);

  function crc16(payload) {
    let crc = 0xffff;
    for (let index = 0; index < payload.length; index += 1) {
      crc ^= payload.charCodeAt(index) << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function generatePayload({ key, amount, merchantName = 'PERFIL TRIBUTE', merchantCity = 'BRASIL' }) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey.valid) throw new Error(normalizedKey.error);

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('O valor da cobrança Pix deve ser maior que zero.');
    }

    const safeName = sanitizeEmvText(merchantName, 25) || 'PERFIL TRIBUTE';
    const safeCity = sanitizeEmvText(merchantCity, 15) || 'BRASIL';
    const merchantAccount = field('00', 'BR.GOV.BCB.PIX') + field('01', normalizedKey.key);

    const payloadWithoutCrc =
      field('00', '01') +
      field('01', '11') +
      field('26', merchantAccount) +
      field('52', '0000') +
      field('53', '986') +
      field('54', numericAmount.toFixed(2)) +
      field('58', 'BR') +
      field('59', safeName) +
      field('60', safeCity) +
      field('62', field('05', '***')) +
      '6304';

    return payloadWithoutCrc + crc16(payloadWithoutCrc);
  }

  const qrCodeUrl = (payload, size = 280) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(payload)}`;

  window.PixPayment = Object.freeze({
    normalizeKey,
    generatePayload,
    qrCodeUrl,
    isValidCpf,
    isValidCnpj,
  });
})();
