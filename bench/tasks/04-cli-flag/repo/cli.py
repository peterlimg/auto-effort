import argparse


def main(argv=None):
    parser = argparse.ArgumentParser(description="Repeat a word")
    parser.add_argument("word")
    parser.add_argument("--times", type=int, default=1)
    args = parser.parse_args(argv)
    print(" ".join([args.word] * args.times))


if __name__ == "__main__":
    main()
