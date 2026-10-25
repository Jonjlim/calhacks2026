"""Print each council agent's agent1q… address (derived from the seeds; no secrets are printed).

    python print_addresses.py
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

from council.agents import ROLES, address_for  # noqa: E402


def main() -> None:
    for role in ROLES:
        print(f"{role:<10} {address_for(role)}")


if __name__ == "__main__":
    main()
