import { DateTime } from "luxon";
import { ValueObject } from "src/shared/domain/value-objects/value-object";

interface ChatDateProps {
    date: DateTime;
}

export class ChatDate extends ValueObject<ChatDateProps> {
    private constructor(props: ChatDateProps) {
        super(props);
    }

    static fromJSDate(date: Date): ChatDate {
        return new ChatDate({ date: DateTime.fromJSDate(date).setZone('America/Bogota') });
    }

    static now(): ChatDate {
        return new ChatDate({ date: DateTime.now().setZone('America/Bogota') });
    }

    get at(): string {
        if (this.props.date.hasSame(DateTime.now(), 'day')) {
            return this.props.date.toFormat('hh:mm a');
        }
        return this.props.date.toFormat('LLL dd');
    }

    toJSDate(): Date {
        return this.props.date.toJSDate();
    }
}