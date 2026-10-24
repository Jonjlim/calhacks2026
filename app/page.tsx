import { CreateRoomForm } from "@/components/room/CreateRoomForm";
import { JoinRoomForm } from "@/components/room/JoinRoomForm";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold text-plum">Unwrap</h1>
        <p className="text-lg text-plum-soft">
          Turn what your friends remember into a gift you choose together.
        </p>
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        <CreateRoomForm />
        <JoinRoomForm />
      </div>
      <Link href="/room/room_demo" className="text-sm text-coral underline">
        Open the mock demo room
      </Link>
    </main>
  );
}
