export class CodingQuestionError extends Error {
  constructor(readonly questionStatus: 'invalidated' | 'delivery_unknown', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CodingQuestionError'
  }
}
