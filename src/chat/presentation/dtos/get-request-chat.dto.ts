import { GetUserDto } from "src/members/presentation/dtos/get-user.dto";
import { GetRequestChatMessageDto } from "./get-request-chat-message.dto";

export class GetRequestChatDto {
    uuid: string;
    requester: GetUserDto;
    createdAt: Date;
    messages: GetRequestChatMessageDto[];
}

// {
//     "_id": {
//         "props": {
//             "value": "b810ddab-bfbc-4e63-89cb-b6273cb9c566"
//         }
//     },
//     "props": {
//         "requester": {
//             "_id": {
//                 "props": {
//                     "value": "69c36014-011e-4847-b964-0a44c5e0b564"
//                 }
//             },
//             "props": {
//                 "avatarUrl": "https://avatars.githubusercontent.com/u/84640980?v=4",
//                 "name": "Test Name",
//                 "username": "@testuser"
//             }
//         },
//         "createdAt": "2025-12-19T21:33:13.892Z",
//         "messages": []
//     }
// }