import { Button, Input, Tooltip, Icon } from "devnonla-ui";
import { type KeyboardEvent, type ReactNode, type RefObject, createContext, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface NewSecretRowHandle {
  focusKey: () => void;
}

interface NewSecretRowProps {
  onCreate: (payload: { key: string; value: string }) => Promise<void>;
  onCancel: () => void;
  active: boolean;
  handleRef: RefObject<NewSecretRowHandle | null>;
  children: ReactNode;
}

interface NewSecretApi {
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

const NewSecretContext = createContext<NewSecretApi | null>(null);

function useNewSecret() {
  const api = useContext(NewSecretContext);
  if (!api) throw new Error("NewSecret cells must render inside NewSecretProvider");
  return api;
}

export function NewSecretProvider({ onCreate, onCancel, active, handleRef, children }: NewSecretRowProps) {
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
    <NewSecretContext.Provider
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
    </NewSecretContext.Provider>
  );
}

export function NewSecretKeyCell() {
  const { key, setKey, submitting, keyInputRef, onKeyKeyDown } = useNewSecret();
  return <Input ref={keyInputRef} size="small" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} onKeyDown={onKeyKeyDown} placeholder="VARIABLE_NAME" disabled={submitting} />;
}

export function NewSecretValueCell() {
  const { value, setValue, submitting, valueInputRef, onValueKeyDown } = useNewSecret();
  return <Input ref={valueInputRef} size="small" type="password" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onValueKeyDown} placeholder="Secret value..." disabled={submitting} />;
}

export function NewSecretActions() {
  const { canSubmit, submitting, submit, cancel } = useNewSecret();
  return (
    <div className="flex items-center justify-end gap-1">
      <Tooltip title="Cancel (Esc)">
        <Button type="icon" size="small" onClick={cancel} disabled={submitting} aria-label="Cancel" icon={<Icon name="close" />} />
      </Tooltip>
      <Tooltip title={canSubmit ? "Add secret (Enter)" : "Enter key and value to add"}>
        <Button type="primary" size="small" onClick={submit} disabled={!canSubmit} loading={submitting} icon={submitting ? undefined : <Icon name="add" size={12} />}>
          Add
        </Button>
      </Tooltip>
    </div>
  );
}
