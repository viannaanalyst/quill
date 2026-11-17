import { isTauri } from "../lib/platform";
import { confirmTouchId, touchIdAvailable } from "../components/LockScreen";
import { toast } from "../components/Toasts";
import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  FileText,
  Inbox,
  Monitor,
  Moon,
  OctagonAlert,
  Send,
  Star,
  Sun,
  Trash2,
} from "../components/icons";
import { Logo, type LogoName } from "../components/Logo";
import { Select } from "../components/Select";
import { applyTheme, type ThemePref } from "../lib/platform";
import { setPref } from "../lib/storage";
import type { FolderId } from "../state/mailbox";
import { ConfirmDialog, Panel, Row, Rows, Seg, Toggle } from "./parts";
import { BannerPicker } from "../inbox/BannerScenes";
import { applyDockIcon, DOCK_ICONS, DOCK_PREF } from "../lib/dockIcon";
import { useClock } from "../calendar/shared";
import { usePref } from "./usePref";

export interface SigAccount {
  /** chave da assinatura: id da conta de exemplo ou e-mail da conta real */
  id: string;
  name: string;
  email: string;
  logo: LogoName;
}

/* ---------------- Geral ---------------- */

export function GeneralSection() {
  const [start, setStart] = usePref<"inbox" | "calendar">("startScreen", "inbox");
  const [markRead, setMarkRead] = usePref("markReadOnOpen", true);
  const [confirmDelete, setConfirmDelete] = usePref("confirmDelete", true);
  const [undo, setUndo] = usePref("undoSeconds", 10);
  return (
    <Panel id="st-general" title="Geral" sub="Como o Quill se comporta no dia a dia.">
      <Rows>
        <Row title="Tela ao abrir o app" sub="Onde você começa quando abre o Quill.">
          <Seg
            label="Tela ao abrir o app"
            value={start}
            onChange={setStart}
            options={[
              { value: "inbox", label: "Caixa de entrada" },
              { value: "calendar", label: "Calendário" },
            ]}
          />
        </Row>
        <Row title="Marcar como lido ao abrir" sub="O e-mail deixa de aparecer em negrito quando você o abre.">
          <Toggle on={markRead} onChange={setMarkRead} label="Marcar como lido ao abrir" />
        </Row>
        <Row title="Confirmar antes de apagar" sub="Pergunta antes de mandar um e-mail para a lixeira.">
          <Toggle on={confirmDelete} onChange={setConfirmDelete} label="Confirmar antes de apagar" />
        </Row>
        <Row title="Tempo para desfazer o envio" sub="Depois de enviar, você tem esse tempo para voltar atrás.">
          <Seg
            label="Tempo para desfazer o envio"
            value={undo}
            onChange={setUndo}
            options={[5, 10, 20, 30].map((n) => ({ value: n, label: `${n} s` }))}
          />
        </Row>
        <Row title="Idioma" sub="Por enquanto o Quill só existe em português.">
          <Select
            label="Idioma"
            size="sm"
            value="pt-BR"
            onChange={() => undefined}
            options={[{ value: "pt-BR", label: "Português (Brasil)" }]}
          />
        </Row>
      </Rows>
    </Panel>
  );
}

/* ---------------- Aparência ---------------- */

/** O tema mostrado é sempre o que está aplicado na página (o menu do avatar também muda isso). */
function currentTheme(): ThemePref {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

export function AppearanceSection() {
  const [theme, setTheme] = useState<ThemePref>(currentTheme);
  const [density, setDensity] = usePref<"comfortable" | "compact">("density", "comfortable");
  const [banner, setBanner] = usePref("showBanner", true);
  const [preview, setPreview] = usePref("showPreview", true);
  const [dockIcon, setDockIcon] = usePref(DOCK_PREF, "default");
  const clock = useClock();

  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(currentTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const choose = (t: ThemePref) => {
    setTheme(t);
    setPref("theme", t);
    applyTheme(t);
  };

  return (
    <Panel id="st-appearance" title="Aparência" sub="Cores e jeito de mostrar a lista de e-mails.">
      <Rows>
        <Row title="Tema" sub="“Sistema” acompanha o claro e o escuro do seu Mac.">
          <Seg
            label="Tema"
            value={theme}
            onChange={choose}
            options={[
              { value: "system", label: "Sistema", icon: <Monitor size={14} aria-hidden /> },
              { value: "light", label: "Claro", icon: <Sun size={14} aria-hidden /> },
              { value: "dark", label: "Escuro", icon: <Moon size={14} aria-hidden /> },
            ]}
          />
        </Row>
        <Row title="Densidade da lista" sub="Compacta mostra mais e-mails de uma vez.">
          <Seg
            label="Densidade da lista"
            value={density}
            onChange={setDensity}
            options={[
              { value: "comfortable", label: "Confortável" },
              { value: "compact", label: "Compacta" },
            ]}
          />
        </Row>
        <Row title="Mostrar a saudação" sub="O “Bom dia” com o resumo no alto da caixa de entrada.">
          <Toggle on={banner} onChange={setBanner} label="Mostrar a saudação" />
        </Row>
        {banner && (
          <div className="st-prow st-banner-block">
            <div className="st-prow-text">
              <div className="st-prow-title" id="st-banner-title">
                Imagem da saudação
              </div>
              <div className="st-prow-sub">No automático, céu de manhã, campo à tarde e cidade à noite. Também dá para usar uma foto sua.</div>
            </div>
            <BannerPicker now={clock} />
          </div>
        )}
        <Row title="Mostrar prévia do texto" sub="A primeira linha da mensagem embaixo do assunto.">
          <Toggle on={preview} onChange={setPreview} label="Mostrar prévia do texto" />
        </Row>
        <div className="st-prow st-banner-block">
          <div className="st-prow-text">
            <div className="st-prow-title" id="st-dock-title">
              Ícone no Dock
            </div>
            <div className="st-prow-sub">Muda na hora, enquanto o Quill está aberto. Com o app fechado, o Dock mostra o Clássico.</div>
          </div>
          <div className="st-dock-grid stagger" role="radiogroup" aria-labelledby="st-dock-title">
            {DOCK_ICONS.map((i) => (
              <button
                key={i.id}
                type="button"
                role="radio"
                aria-checked={dockIcon === i.id}
                className="st-dock-item"
                onClick={() => {
                  setDockIcon(i.id);
                  void applyDockIcon(i.id).catch(() => toast("Não consegui trocar o ícone", "error"));
                }}
              >
                <img src={i.src} alt="" width={56} height={56} draggable={false} />
                <span>{i.label}</span>
              </button>
            ))}
          </div>
        </div>
      </Rows>
    </Panel>
  );
}

/* ---------------- Notificações ---------------- */

const HOURS = Array.from({ length: 24 }, (_, h) => {
  const t = `${String(h).padStart(2, "0")}:00`;
  return { value: t, label: t };
});

export function NotificationsSection() {
  const [notify, setNotify] = usePref("notify", true);
  const [sound, setSound] = usePref("notifySound", true);
  const [peopleOnly, setPeopleOnly] = usePref("notifyPeopleOnly", true);
  const [quiet, setQuiet] = usePref("quietHours", false);
  const [from, setFrom] = usePref("quietFrom", "22:00");
  const [to, setTo] = usePref("quietTo", "07:00");
  return (
    <Panel id="st-notifications" title="Notificações" sub="Quando e como o Quill avisa que chegou e-mail.">
      <Rows>
        <Row title="Avisar quando chegar e-mail" sub="Mostra um aviso do sistema com remetente e assunto.">
          <Toggle on={notify} onChange={setNotify} label="Avisar quando chegar e-mail" />
        </Row>
        <Row title="Tocar um som" sub="Um som discreto junto com o aviso.">
          <Toggle on={sound} onChange={setSound} label="Tocar um som" disabled={!notify} />
        </Row>
        <Row title="Só de pessoas" sub="Ignora propaganda, newsletters e avisos automáticos.">
          <Toggle on={peopleOnly} onChange={setPeopleOnly} label="Só de pessoas" disabled={!notify} />
        </Row>
        <Row title="Horário silencioso" sub="Nesse período o Quill não avisa nada.">
          <Toggle on={quiet} onChange={setQuiet} label="Horário silencioso" disabled={!notify} />
        </Row>
        {quiet && notify && (
          <Row title="Período" sub="Começa e termina todos os dias.">
            <div className="st-range">
              <Select label="Começa às" size="sm" value={from} onChange={setFrom} options={HOURS} />
              <span aria-hidden>até</span>
              <Select label="Termina às" size="sm" value={to} onChange={setTo} options={HOURS} />
            </div>
          </Row>
        )}
      </Rows>
    </Panel>
  );
}

/* ---------------- Assinaturas ---------------- */

function SignatureEditor({ account }: { account: SigAccount }) {
  const [sig, setSig] = usePref(`signature:${account.id}`, "");
  const labelId = `st-sig-${account.id.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <div className="st-sig">
      <div className="st-sig-head">
        <span className="st-logo">
          <Logo name={account.logo} size={19} />
        </span>
        <div className="st-sig-who">
          <div className="st-prow-title" id={labelId}>
            {account.name}
          </div>
          <div className="st-prow-sub">{account.email}</div>
        </div>
      </div>
      <textarea
        className="st-textarea"
        aria-labelledby={labelId}
        placeholder="Escreva a assinatura que entra no fim dos e-mails desta conta"
        rows={4}
        value={sig}
        onChange={(e) => setSig(e.target.value)}
      />
    </div>
  );
}

export function SignaturesSection({ accounts }: { accounts: SigAccount[] }) {
  return (
    <Panel id="st-signatures" title="Assinaturas" sub="Uma assinatura para cada conta, salva enquanto você digita.">
      {accounts.length === 0 ? (
        <p className="st-empty">Conecte uma conta em “Contas” para escrever a assinatura dela.</p>
      ) : (
        <div className="st-sigs stagger">
          {accounts.map((a) => (
            <SignatureEditor key={a.id} account={a} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------------- Marcadores e pastas ---------------- */

const FOLDERS: { id: FolderId; label: string; icon: ReactNode; locked?: boolean }[] = [
  { id: "inbox", label: "Entrada", icon: <Inbox size={17} aria-hidden />, locked: true },
  { id: "starred", label: "Importantes", icon: <Star size={17} aria-hidden /> },
  { id: "sent", label: "Enviados", icon: <Send size={17} aria-hidden /> },
  { id: "drafts", label: "Rascunhos", icon: <FileText size={17} aria-hidden /> },
  { id: "archive", label: "Arquivo", icon: <Archive size={17} aria-hidden /> },
  { id: "spam", label: "Spam", icon: <OctagonAlert size={17} aria-hidden /> },
  { id: "trash", label: "Lixeira", icon: <Trash2 size={17} aria-hidden /> },
];

export function LabelsSection() {
  const [visible, setVisible] = usePref<string[]>(
    "folders.visible",
    FOLDERS.map((f) => f.id),
  );
  const toggle = (id: string, on: boolean) => setVisible(on ? [...new Set([...visible, id])] : visible.filter((v) => v !== id));
  return (
    <Panel id="st-labels" title="Marcadores e pastas" sub="Escolha o que aparece na barra lateral.">
      <Rows>
        {FOLDERS.map((f) => (
          <Row key={f.id} icon={f.icon} title={f.label} sub={f.locked ? "Sempre visível" : "Mostrar na barra"}>
            <Toggle on={f.locked || visible.includes(f.id)} disabled={f.locked} onChange={(v) => toggle(f.id, v)} label={`Mostrar ${f.label} na barra`} />
          </Row>
        ))}
      </Rows>
    </Panel>
  );
}

/* ---------------- Atalhos ---------------- */

const SHORTCUTS: { keys: string[]; text: string }[] = [
  { keys: ["⌘", "K"], text: "Busca e comandos" },
  { keys: ["C"], text: "Escrever um e-mail" },
  { keys: ["R"], text: "Responder" },
  { keys: ["E"], text: "Arquivar" },
  { keys: ["#"], text: "Mandar para a lixeira" },
  { keys: ["/"], text: "Buscar" },
  { keys: ["⌘", ","], text: "Abrir os ajustes" },
  { keys: ["Esc"], text: "Fechar" },
];

export function ShortcutsSection() {
  return (
    <Panel id="st-shortcuts" title="Atalhos de teclado" sub="Para fazer tudo sem tirar a mão do teclado.">
      <ul className="st-keys stagger">
        {SHORTCUTS.map((s) => (
          <li key={s.text} className="st-key-row">
            <span>{s.text}</span>
            <span className="st-key-caps">
              {s.keys.map((k) => (
                <kbd key={k} className="st-key">
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------- Privacidade ---------------- */

export function PrivacySection() {
  const [touchId, setTouchId] = usePref("touchId", false);
  /** Ao ligar: confere se o Mac tem Touch ID e pede uma vez para confirmar. */
  const changeTouchId = async (on: boolean) => {
    if (!on || !isTauri) return setTouchId(on);
    if (!(await touchIdAvailable())) return toast("Este computador não tem Touch ID nem senha configurados.", "error");
    if (await confirmTouchId()) {
      setTouchId(true);
      toast("Touch ID ligado: o Quill vai pedir sua digital ao abrir");
    }
  };
  const [blockImages, setBlockImages] = usePref("blockRemoteImages", true);
  const [senderLogos, setSenderLogos] = usePref("senderLogos", true);
  const [confirming, setConfirming] = useState(false);

  /** Apaga as preferências deste Mac (as contas e senhas ficam nas Chaves do sistema) e recarrega. */
  const wipe = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("quill."))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* armazenamento indisponível */
    }
    window.location.reload();
  };

  return (
    <>
      <Panel id="st-privacy" title="Privacidade" sub="O Quill guarda tudo só neste Mac.">
        <Rows>
          <Row title="Abrir o app com Touch ID" sub="Pede sua digital sempre que o Quill abrir. Só no Mac.">
            <Toggle on={touchId} onChange={(v) => void changeTouchId(v)} label="Abrir o app com Touch ID" />
          </Row>
          <Row title="Bloquear imagens externas" sub="Impede que remetentes saibam que você abriu o e-mail.">
            <Toggle on={blockImages} onChange={setBlockImages} label="Bloquear imagens externas nos e-mails" />
          </Row>
          <Row title="Fotos e logos dos remetentes" sub="Mostra a foto (Gravatar) ou o logo do site de quem enviou. Para isso o Quill consulta o Gravatar e os ícones de sites do Google e da DuckDuckGo.">
            <Toggle on={senderLogos} onChange={setSenderLogos} label="Mostrar logo das empresas nos remetentes" />
          </Row>
          <Row title="Apagar dados deste Mac" sub="Limpa as preferências do Quill e recomeça do zero. Seus e-mails continuam no servidor.">
            <button className="btn glass sm danger" onClick={() => setConfirming(true)}>
              <Trash2 size={14} aria-hidden />
              Apagar dados
            </button>
          </Row>
        </Rows>
      </Panel>
      {confirming && (
        <ConfirmDialog
          title="Apagar os dados deste Mac?"
          text="As preferências e o cache do Quill saem deste Mac e o app recomeça do zero. Nada é apagado nos servidores das suas contas."
          confirmLabel="Apagar dados"
          icon={<Trash2 size={15} aria-hidden />}
          onCancel={() => setConfirming(false)}
          onConfirm={wipe}
        />
      )}
    </>
  );
}
