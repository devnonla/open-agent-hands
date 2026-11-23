import { Button, Input, Tooltip, Icon } from "devnonla-ui";
import { type KeyboardEvent, type ReactNode, type RefObject, createContext, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface NewKvRowHandle {
  focusKey: () => void;
}

interface NewKvRowProps {
  onCreate: (payload: { key: string; value: string }) => Promise<void>;
  onCancel: () => void;
  active: boolean;
  handleRef: RefObject<NewKvRowHandle | null>;
  children: ReactNode;
}

interface NewKvApi {
  key: string;
  setKey: (value: string) => void;
  value: string;
  setValue: (value: string) => void;
  submitting: boolean;
  canSubmit: boolean;
  keyInputRef: RefObject<HTMLInputElement | null>;
  valueInputRef: RefObject<HTMLInputElement | null>;
  onKeyKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onValueKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  submit: () => void;
  cancel: () => void;
}

const NewKvContext = createContext<NewKvApi | null>(null);

function useNewKv() {
  const api = useContext(NewKvContext);
  if (!api) throw new Error("New KV cells must render inside NewKvProvider");
  return api;
}

export function NewKvProvider({ onCreate, onCancel, active, handleRef, children }: NewKvRowProps) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const valueInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(handleRef, () => ({
    focusKey: () => {
      keyInputRef.current?.focus();
      keyInputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  }));

  useEffect(() => {
    if (!active) return;
    keyInputRef.current?.focus();
  }, [active]);

  const submit = async () => {
    const trimmedKey = key.trim().toUpperCase();
    if (!trimmedKey || !value || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({ key: trimmedKey, value });
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!value) valueInputRef.current?.focus();
      else void submit();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  const onValueKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <NewKvContext.Provider
      value={{
        key,
        setKey,
        value,
        setValue,
        submitting,
        canSubmit: key.trim().length > 0 && value.length > 0 && !submitting,
        keyInputRef,
        valueInputRef,
        onKeyKeyDown,
        onValueKeyDown,
        submit: () => void submit(),
        cancel: onCancel,
      }}
    >
      {children}
    </NewKvContext.Provider>
  );
}

export function NewKvKeyCell() {
  const { key, setKey, submitting, keyInputRef, onKeyKeyDown } = useNewKv();
  return <Input ref={keyInputRef} size="small" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} onKeyDown={onKeyKeyDown} placeholder="BASE_URL" disabled={submitting} />;
}

export function NewKvValueCell() {
  const { value, setValue, submitting, valueInputRef, onValueKeyDown } = useNewKv();
  return <Input ref={valueInputRef} size="small" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onValueKeyDown} placeholder="Value" disabled={submitting} />;
}

export function NewKvActions() {
  const { canSubmit, submitting, submit, cancel } = useNewKv();
  return (
    <div className="flex items-center justify-end gap-1">
      <Tooltip title="Cancel (Esc)">
        <Button type="icon" size="small" onClick={cancel} disabled={submitting} aria-label="Cancel" icon={<Icon name="close" />} />
      </Tooltip>
      <Tooltip title={canSubmit ? "Add entry (Enter)" : "Enter key and value to add"}>
        <Button type="primary" size="small" onClick={submit} disabled={!canSubmit} loading={submitting} icon={submitting ? undefined : <Icon name="add" size={12} />}>
          Add
        </Button>
      </Tooltip>
    </div>
  );
}
