import './open.css';

type Row = { seq: number; name: string; qty: number; phone: string };
type Data = { title?: string; updatedAt?: string; rows?: Row[] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** 혹시라도 가운데 자리가 보이는 번호가 오면 뒷 4자리만 남김 */
function maskPhone(p: string): string {
  const d = String(p || '').replace(/\D/g, '');
  if (/\*/.test(p) && d.length <= 7) return p;
  return d.length >= 4 ? `010-****-${d.slice(-4)}` : '';
}

function fmtUpdated(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `기준 시각: ${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function render(rows: Row[], q: string) {
  const body = $<HTMLTableSectionElement>('rows');
  const term = q.trim();
  const digits = term.replace(/\D/g, '');
  const list = rows.filter((r) => !term || r.name.includes(term) || (digits.length >= 2 && r.phone.replace(/\D/g, '').includes(digits)));
  body.replaceChildren(
    ...list.map((r) => {
      const tr = document.createElement('tr');
      const cells: [string, string][] = [
        [String(r.seq), 'c-seq'],
        [r.name, 'c-name'],
        [r.phone, 'c-phone'],
        [`${r.qty}개`, 'c-qty'],
      ];
      for (const [text, cls] of cells) {
        const td = document.createElement('td');
        td.className = cls;
        td.textContent = text;
        tr.appendChild(td);
      }
      return tr;
    }),
  );
  $('status').textContent = list.length ? '' : '찾는 신청이 없어요';
  $('status').hidden = list.length > 0;
}

async function main() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}public-list.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as Data;
    const rows = (data.rows || [])
      .map((r) => ({ seq: Number(r.seq) || 0, name: String(r.name || ''), qty: Number(r.qty) || 0, phone: maskPhone(String(r.phone || '')) }))
      .sort((a, b) => a.seq - b.seq);
    if (data.title) {
      $('title').textContent = data.title;
      document.title = data.title;
    }
    $('count').textContent = `${rows.length}건`;
    $('sum').textContent = `${rows.reduce((s, r) => s + r.qty, 0)}개`;
    $('updated').textContent = fmtUpdated(data.updatedAt);
    $('table').hidden = false;
    render(rows, '');
    $<HTMLInputElement>('q').addEventListener('input', (e) => render(rows, (e.target as HTMLInputElement).value));
  } catch {
    $('status').textContent = '목록을 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.';
  }
}

void main();
