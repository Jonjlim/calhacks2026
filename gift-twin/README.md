# Gift Twin companion

The recipient's Mac companion for Unwrap. It pairs this Mac with a gift room. Then, with the recipient's one-time permission, it uploads the messages they sent (never other people's) to a private 24-hour vault. There, a cloud twin agent posts gift ideas and votes up or down on the room's ideas.

```bash
npm run twin -- pair <CODE>      # connect to a gift room (code from /room/<id>/twin)
npm run twin -- share --fixture  # sample messages; drop --fixture for real iMessage
npm run twin -- forget           # delete the uploaded messages now
npm run twin -- doctor           # check Full Disk Access and setup
npm run test:twin                # unit tests
```

Reads only the most recent 3 MB of message content (`--max-mb` to change). Needs Node 23.6+. No extra dependencies: `node:sqlite` for `chat.db`, `convex/browser` for the room connection.

Design, privacy model, and production path: [docs/GIFT_TWIN.md](../docs/GIFT_TWIN.md).
