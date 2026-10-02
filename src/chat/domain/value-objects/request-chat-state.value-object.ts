import { ValueObject } from 'src/shared/domain/value-objects/value-object';

const RequestChatStates = Object.freeze({
  InProgress: 'InProgress',
  Rejected: 'Rejected',
  Approved: 'Approved',
});

export type RequestChatStateType =
  (typeof RequestChatStates)[keyof typeof RequestChatStates];

function isRequestChatStateType(value: string): value is RequestChatStateType {
  return (Object.values(RequestChatStates) as string[]).includes(value);
}

interface RequestChatStateProps {
  value: RequestChatStateType;
}

export class RequestChatState extends ValueObject<RequestChatStateProps> {
  private constructor(props: RequestChatStateProps) {
    super(props);
  }

  static create(value: string): RequestChatState {
    if (!isRequestChatStateType(value)) {
      throw new Error(`Invalid request chat state: ${value}`);
    }

    return new RequestChatState({ value: RequestChatStates[value] });
  }

  static InProgress(): RequestChatState {
    return new RequestChatState({ value: RequestChatStates.InProgress });
  }

  static Rejected(): RequestChatState {
    return new RequestChatState({ value: RequestChatStates.Rejected });
  }

  static Approved(): RequestChatState {
    return new RequestChatState({ value: RequestChatStates.Approved });
  }

  isApproved(): boolean {
    return this.props.value === RequestChatStates.Approved;
  }

  isRejected(): boolean {
    return this.props.value === RequestChatStates.Rejected;
  }
}
