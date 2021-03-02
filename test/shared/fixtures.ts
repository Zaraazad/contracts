import '@nomiclabs/hardhat-waffle'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import Transfer from '../../lib/Transfer'

import { getL2SpecificArtifact } from './utils'
import { IFixture } from './interfaces'

import { getMessengerWrapperDefaults, getL2BridgeDefaults } from '../../config/utils'
import { IGetMessengerWrapperDefaults, IGetL2BridgeDefaults } from '../../config/interfaces'
import {
  CHAIN_IDS,
  DEFAULT_DEADLINE,
  RELAYER_FEE,
  TRANSFER_AMOUNT,
  ALL_SUPPORTED_CHAIN_IDS,
  DEFAULT_H_TOKEN_NAME,
  DEFAULT_H_TOKEN_SYMBOL,
  DEFAULT_H_TOKEN_DECIMALS
} from '../../config/constants'

export async function fixture (l1ChainId: BigNumber, l2ChainId: BigNumber, l1AlreadySetOpts: any = {}): Promise<IFixture> {
  const {
    l2_bridgeArtifact,
    l1_messengerWrapperArtifact
  } = getL2SpecificArtifact(l2ChainId)
  const accounts = await ethers.getSigners()
  const [
    user,
    liquidityProvider,
    bonder,
    challenger,
    governance,
    relayer,
    otherUser
  ] = accounts

  // Factories
  const L1_CanonicalBridge = await ethers.getContractFactory(
    'contracts/test/Mock_L1_CanonicalBridge.sol:Mock_L1_CanonicalBridge'
  )
  const L1_Bridge = await ethers.getContractFactory(
    'contracts/test/Mock_L1_ERC20_Bridge.sol:Mock_L1_ERC20_Bridge'
  )
  const L2_Bridge = await ethers.getContractFactory(
    `contracts/test/${l2_bridgeArtifact}`
  )
  const L1_Messenger = await ethers.getContractFactory(
    'contracts/test/Mock_L1_Messenger.sol:Mock_L1_Messenger'
  )
  const L1_MessengerWrapper = await ethers.getContractFactory(
    `contracts/wrappers/${l1_messengerWrapperArtifact}`
  )
  const L2_HopBridgeToken = await ethers.getContractFactory(
    'contracts/bridges/HopBridgeToken.sol:HopBridgeToken'
  )
  const L2_Messenger = await ethers.getContractFactory(
    'contracts/test/Mock_L2_Messenger.sol:Mock_L2_Messenger'
  )
  const L2_UniswapRouter = await ethers.getContractFactory(
    'contracts/uniswap/UniswapV2Router02.sol:UniswapV2Router02'
  )
  const L2_UniswapFactory = await ethers.getContractFactory(
    '@uniswap/v2-core/contracts/UniswapV2Factory.sol:UniswapV2Factory'
  )

  // Mock Factories
  const MockERC20 = await ethers.getContractFactory(
    'contracts/test/MockERC20.sol:MockERC20'
  )
  const MockAccounting = await ethers.getContractFactory(
    'contracts/test/Mock_Accounting.sol:Mock_Accounting'
  )
  const MockBridge = await ethers.getContractFactory(
    'contracts/test/Mock_Bridge.sol:Mock_Bridge'
  )

  // Deploy canonical tokens
  let l1_canonicalToken
  if (l1AlreadySetOpts?.l1CanonicalTokenAddress) {
    l1_canonicalToken = await MockERC20.attach(l1AlreadySetOpts.l1CanonicalTokenAddress)
  } else {
    l1_canonicalToken = await MockERC20.deploy('Dai Stable Token', 'DAI')
  }
  const l2_canonicalToken = await MockERC20.deploy(
    'L2 Dai Stable Token',
    'L2DAI'
  )

  // Deploy canonical messengers
  const l1_messenger = await L1_Messenger.deploy(l1_canonicalToken.address)
  const l2_messenger = await L2_Messenger.deploy(l2_canonicalToken.address)

  // Deploy canonical bridges
  const l1_canonicalBridge = await L1_CanonicalBridge.deploy(
    l1_canonicalToken.address,
    l1_messenger.address
  )

  // Deploy Uniswap contracts
  const weth = await MockERC20.deploy('WETH', 'WETH')
  const l2_uniswapFactory = await L2_UniswapFactory.deploy(
    await user.getAddress()
  )
  const l2_uniswapRouter = await L2_UniswapRouter.deploy(
    l2_uniswapFactory.address,
    weth.address
  )

  // Deploy Hop L1 contracts
  let l1_bridge
  if (l1AlreadySetOpts?.l1BridgeAddress) {
    l1_bridge = await L1_Bridge.attach(l1AlreadySetOpts.l1BridgeAddress)
  } else {
    l1_bridge = await L1_Bridge.deploy(
      l1_canonicalToken.address,
      [await bonder.getAddress()]
    )
  }

  // Deploy Hop bridge token
  const l2_hopBridgeToken = await L2_HopBridgeToken.deploy(
    await governance.getAddress(),
    DEFAULT_H_TOKEN_NAME,
    DEFAULT_H_TOKEN_SYMBOL,
    DEFAULT_H_TOKEN_DECIMALS
  )

  // Deploy Hop L2 contracts
  const l2CanonicalTokenIsEth: boolean = false
  let l2BridgeDefaults: IGetL2BridgeDefaults[] = getL2BridgeDefaults(
    l2ChainId,
    l2_messenger.address,
    await governance.getAddress(),
    l2_hopBridgeToken.address,
    l2_canonicalToken.address,
    l2CanonicalTokenIsEth,
    l1_bridge.address,
    ALL_SUPPORTED_CHAIN_IDS,
    l2_uniswapRouter.address,
    [await bonder.getAddress()],
    l1ChainId
  )
  const l2_bridge = await L2_Bridge.deploy(
    ...l2BridgeDefaults
  )

  // Deploy Messenger Wrapper
  const messengerWrapperDefaults: IGetMessengerWrapperDefaults[] = getMessengerWrapperDefaults(
    l2ChainId,
    l1_bridge.address,
    l2_bridge.address,
    l1_messenger.address
  )
  const l1_messengerWrapper = await L1_MessengerWrapper.deploy(
    ...messengerWrapperDefaults
  )

  // Mocks
  const mockAccounting = await MockAccounting.deploy([await bonder.getAddress()])
  const mockBridge = await MockBridge.deploy([await bonder.getAddress()])

  // Transfers
  const genericTransfer = {
    amount: TRANSFER_AMOUNT,
    transferNonce: 0,
    relayerFee: RELAYER_FEE,
    amountOutMin: BigNumber.from('0'),
    destinationAmountOutMin: BigNumber.from('0'),
    destinationDeadline: DEFAULT_DEADLINE
  }

  const transfers: Transfer[] = [
    new Transfer({
      chainId: CHAIN_IDS.ETHEREUM.MAINNET,
      sender: user,
      recipient: otherUser,
      deadline: BigNumber.from('0'),
      ...genericTransfer
    }),
    new Transfer({
      chainId: CHAIN_IDS.ARBITRUM.TESTNET_3,
      sender: user,
      recipient: otherUser,
      deadline: DEFAULT_DEADLINE,
      ...genericTransfer
    }),
    new Transfer({
      chainId: CHAIN_IDS.ETHEREUM.MAINNET,
      sender: user,
      recipient: user,
      deadline: BigNumber.from('0'),
      ...genericTransfer
    }),
    new Transfer({
      chainId: CHAIN_IDS.ARBITRUM.TESTNET_3,
      sender: user,
      recipient: user,
      deadline: DEFAULT_DEADLINE,
      ...genericTransfer
    }),
  ]

  return {
    accounts,
    user,
    liquidityProvider,
    bonder,
    challenger,
    governance,
    relayer,
    otherUser,
    L1_CanonicalBridge,
    L1_Bridge,
    L2_HopBridgeToken,
    L2_Bridge,
    MockERC20,
    L1_MessengerWrapper,
    L1_Messenger,
    L2_Messenger,
    L2_UniswapRouter,
    L2_UniswapFactory,
    MockAccounting,
    MockBridge,
    l1_canonicalToken,
    l1_canonicalBridge,
    l1_messenger,
    l1_messengerWrapper,
    l1_bridge,
    l2_messenger,
    l2_hopBridgeToken,
    l2_bridge,
    l2_canonicalToken,
    l2_uniswapFactory,
    l2_uniswapRouter,
    mockAccounting,
    mockBridge,
    transfers
  }
}
