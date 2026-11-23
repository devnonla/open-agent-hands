import { Alert, Text } from "devnonla-ui";

interface ValidationBannerProps {
  errors: string[];
  onDismiss: () => void;
}

export function ValidationBanner({ errors, onDismiss }: ValidationBannerProps) {
  return (
    <Alert
      type="error"
      showIcon
      closable
      onClose={onDismiss}
      className="shrink-0 rounded-none border-x-0 border-t-0 px-4 py-2"
      message={
        errors.length === 1 && errors[0].includes(" ") ? (
          errors[0]
        ) : (
          <>
            Missing:{" "}
            {errors.map((e, i) => (
              <span key={e}>
                {i > 0 && (i === errors.length - 1 ? " and " : ", ")}
                <Text code>{e}</Text>
              </span>
            ))}
          </>
        )
      }
    />
  );
}
