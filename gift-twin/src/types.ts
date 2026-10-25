/** One message read from the local Messages database. Only `text` and `sentAt` of the recipient's own messages are ever uploaded. */
export interface LocalMessage {
  id: number;
  text: string;
  fromMe: boolean;
  sentAt: number;
  chatId: number;
}
