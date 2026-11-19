/** Tất cả các key hợp lệ của AppSettings. Dùng khi get/set để tránh typo. */
export enum SettingKey {
  // General
  Timezone = "timezone",

  // AI Providers
  OpenAIKey = "openaiKey",
  OpenAIBaseUrl = "openaiBaseUrl",
  AnthropicKey = "anthropicKey",
  GoogleKey = "googleKey",
  GoogleBaseUrl = "googleBaseUrl",
  OpenRouterKey = "openrouterKey",
  OllamaEndpoint = "ollamaEndpoint",

  // Nonla Bot — workspace assistant
  NonlaBotAssistantProvider = "nonlaBotAssistantProvider",
  NonlaBotAssistantModel = "nonlaBotAssistantModel",
}
